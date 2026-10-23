import SwiftUI

// 顧客詳細（ネイティブ）。Web の /app/customers/[id] と同じ集計・並び（2026-10-24）

struct NCDCustomer: Codable {
    let id: String; let name: String; let nameKana: String?; let phone: String?; let email: String?; let birthday: String?; let gender: String?
    let postalCode: String?; let address: String?; let memberNo: String?; let memberRank: String?; let pointBalance: Int
    let visitCount: Int; let totalSpent: Int; let cancelCount: Int; let noShowCount: Int; let lastVisitAt: String?; let createdAt: String; let anonymized: Bool
    let allergyNote: String?; let dislikeNote: String?; let preferenceNote: String?; let seatPreference: String?; let anniversaryNote: String?; let serviceNote: String?
}
struct NCDRfm: Codable { let label: String; let tone: String; let detail: String }
struct NCDLtv: Codable { let actual: Int; let projected12m: Int?; let avgSpend: Int; let visitsPerMonth: Double? }
struct NCDNote: Codable, Identifiable { let id: String; let body: String; let createdAt: String; let creatorName: String? }
struct NCDPoint: Codable, Identifiable { let id: String; let createdAt: String; let kindLabel: String; let points: Int; let balanceAfter: Int; let note: String?; let orderId: String? }
struct NCDStore: Codable, Identifiable { var id: String { storeId }; let storeId: String; let storeName: String; let visitCount: Int; let totalSpent: Int }
struct NCDProduct: Codable, Hashable { let name: String; let quantity: Int; let amount: Int }
struct NCDPayment: Codable, Identifiable { let id: String; let paidAt: String; let storeName: String?; let method: String; let amount: Int }
struct NCDReservation: Codable, Identifiable { let id: String; let startAt: String; let storeName: String?; let partySize: Int; let status: NCBadge; let cancelReason: String? }
struct NCDOrder: Codable, Identifiable { let id: String; let openedAt: String; let storeName: String?; let total: Int }
struct NCDPayload: Codable {
    let canWrite: Bool; let loyaltyEnabled: Bool; let customer: NCDCustomer
    let segments: [NCBadge]; let rfm: NCDRfm; let extended: [NCBadge]; let tags: [NCTag]
    let reservationCount: Int; let avgSpend: Int; let daysSinceLastVisit: Int?; let ltv: NCDLtv
    let notes: [NCDNote]; let points: [NCDPoint]; let stores: [NCDStore]; let topProducts: [NCDProduct]
    let payments: [NCDPayment]; let reservations: [NCDReservation]; let orders: [NCDOrder]
}

struct NativeCustomerDetailView: View {
    let id: String
    @ObservedObject var list: NativeCustomersModel
    let onBack: () -> Void
    let onWeb: (String) -> Void

    @State private var payload: NCDPayload?
    @State private var loadError: String?
    @State private var editAttrs = false
    @State private var noteText = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { onBack() } label: {
                    HStack(spacing: 4) { Image(systemName: "chevron.left"); Text("顧客一覧へ戻る") }.font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.royal)
                }.buttonStyle(.plain)
                Spacer()
                if let p = payload {
                    if p.canWrite { pill("arrow.clockwise", "再計算") { Task { await recalc() } } }
                    pill("safari", "編集・その他（Web）") { onWeb("/app/customers/\(id)") }
                }
            }
            .padding(.horizontal, 16).frame(height: 56).background(Color.white)
            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
            if let p = payload {
                ScrollView { content(p).padding(16) }
            } else {
                Spacer()
                if let e = loadError {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await load() } } }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task { await load() }
        .sheet(isPresented: $editAttrs) { if let p = payload { NCAttributesSheet(c: p.customer, list: list) { saved in editAttrs = false; if saved { Task { await load() } } } } }
    }

    private func content(_ p: NCDPayload) -> some View {
        let c = p.customer
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(c.name).font(.system(size: 24, weight: .heavy)).foregroundColor(NFColor.navy)
                    if c.anonymized { NPBadge(text: "匿名化済み", color: NFColor.ink3) }
                }
                Text("登録日 \(NPDate.slash(NNDateOnly.jst(c.createdAt)))\(c.nameKana.map { "｜\($0)" } ?? "")").font(.system(size: 13)).foregroundColor(NFColor.ink3)
            }
            NCFlow(spacing: 6) {
                Text("自動分類").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                if p.segments.isEmpty { Text("—").foregroundColor(NFColor.ink3) }
                ForEach(p.segments, id: \.self) { b in NPBadge(text: b.label, color: NCTone.color(b.tone)) }
                NPBadge(text: p.rfm.label, color: NCTone.color(p.rfm.tone))
                if !p.extended.isEmpty {
                    Text("拡張").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.leading, 6)
                    ForEach(p.extended, id: \.self) { b in NPBadge(text: b.label, color: NCTone.color(b.tone)) }
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))

            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 14) {
                    card("基本情報") {
                        kv("電話番号", c.phone); kv("メールアドレス", c.email)
                        kv("誕生日", c.birthday.map(NPDate.slash))
                        kv("性別", c.gender == "male" ? "男性" : c.gender == "female" ? "女性" : c.gender == "other" ? "その他" : nil)
                        kv("住所", [c.postalCode.map { "〒\($0)" }, c.address].compactMap { $0 }.joined(separator: " ").nilIfEmpty)
                    }
                    card("ポイント・会員") {
                        if p.loyaltyEnabled { kv("ポイント残高", "\(c.pointBalance)pt") } else { Text("ポイント制度は無効です").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                        kv("会員番号", c.memberNo); kv("会員ランク", c.memberRank)
                    }
                    card("属性", action: p.canWrite && !c.anonymized ? ("編集", { editAttrs = true }) : nil) {
                        kv("アレルギー", c.allergyNote, danger: true); kv("苦手", c.dislikeNote); kv("好み", c.preferenceNote)
                        kv("席の希望", c.seatPreference); kv("記念日", c.anniversaryNote); kv("接客メモ", c.serviceNote)
                    }
                    card("接客メモ") {
                        if p.canWrite && !c.anonymized {
                            HStack(alignment: .bottom, spacing: 8) {
                                TextField("メモを追加", text: $noteText, axis: .vertical).lineLimit(1...4).font(.system(size: 14)).padding(10)
                                    .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                                Button("追加") { Task { await addNote() } }.font(.system(size: 14, weight: .bold)).disabled(noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || list.busy)
                            }
                        }
                        if p.notes.isEmpty { Text("メモはありません").font(.system(size: 13)).foregroundColor(NFColor.ink3) }
                        ForEach(p.notes) { n in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(n.body).font(.system(size: 14)).foregroundColor(NFColor.ink)
                                Text("\(NNoticeTime.fmt(n.createdAt))\(n.creatorName.map { "・\($0)" } ?? "")").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color(hex: 0xF6F6F9)))
                        }
                    }
                    card("タグ") {
                        if p.tags.isEmpty { Text("—").foregroundColor(NFColor.ink3) }
                        NCFlow(spacing: 6) { ForEach(p.tags) { t in NPBadge(text: t.name, color: NCTone.hex(t.color)) } }
                    }
                }
                .frame(width: 360)

                VStack(spacing: 14) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 10) {
                        stat("来店回数", "\(c.visitCount)回")
                        stat("予約回数", "\(p.reservationCount)回")
                        stat("キャンセル回数", "\(c.cancelCount)回", tone: c.cancelCount > 0 ? NCTone.color("warning") : NFColor.navy)
                        stat("無断キャンセル", "\(c.noShowCount)回", tone: c.noShowCount > 0 ? NFColor.danger : NFColor.navy)
                        stat("累計利用額", NT.yen(c.totalSpent), tone: NFColor.royal, sub: "返金控除後（純額）")
                        stat("平均客単価", NT.yen(p.avgSpend))
                        stat("最終来店からの日数", p.daysSinceLastVisit.map { "\($0)日" } ?? "—")
                    }
                    card("LTV（顧客生涯価値）") {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("実績LTV（累計利用額・返金控除後）").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                                Text(NT.yen(p.ltv.actual)).font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.royal)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("12ヶ月予測LTV（参考値）").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                                Text(p.ltv.projected12m.map { NT.yen($0) } ?? "算出中").font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
                        Text(p.ltv.projected12m == nil
                             ? "来店実績が2回未満のため予測は算出されません。来店実績が蓄積すると表示されます。"
                             : "平均客単価 \(NT.yen(p.ltv.avgSpend)) × 月間来店頻度 \(p.ltv.visitsPerMonth.map { String(format: "%g", $0) } ?? "—")回 × 12ヶ月で算出した参考値です。実績を保証するものではありません。")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    table("ポイント履歴（直近20件）", empty: "ポイント履歴はありません", count: p.points.count) {
                        ForEach(p.points) { x in
                            line([NNoticeTime.fmt(x.createdAt), x.kindLabel, x.points >= 0 ? "+\(x.points)pt" : "\(x.points)pt", "\(x.balanceAfter)pt", x.note ?? "—"],
                                 colors: [nil, nil, x.points >= 0 ? NCTone.color("success") : NFColor.danger, nil, NFColor.ink3])
                        }
                    }
                    table("利用店舗", empty: "利用店舗の実績はありません", count: p.stores.count) {
                        ForEach(p.stores) { s in line([s.storeName, "\(s.visitCount)回", NT.yen(s.totalSpent)]) }
                    }
                    table("よく注文する商品 TOP5", empty: "注文実績はありません", count: p.topProducts.count) {
                        ForEach(p.topProducts, id: \.self) { x in line([x.name, "\(x.quantity)点", NT.yen(x.amount)]) }
                    }
                    table("決済履歴（直近20件）", empty: "決済履歴はありません", count: p.payments.count) {
                        ForEach(p.payments) { x in line([NNoticeTime.fmt(x.paidAt), x.storeName ?? "—", x.method, NT.yen(x.amount)]) }
                    }
                    table("予約履歴（直近20件）", empty: "予約履歴はありません", count: p.reservations.count) {
                        ForEach(p.reservations) { r in
                            HStack(spacing: 8) {
                                Text(NNoticeTime.fmt(r.startAt)).frame(maxWidth: .infinity, alignment: .leading)
                                Text(r.storeName ?? "—").frame(maxWidth: .infinity, alignment: .leading)
                                Text("\(r.partySize)名").frame(width: 50, alignment: .trailing)
                                NPBadge(text: r.status.label, color: NCTone.color(r.status.tone)).frame(width: 110, alignment: .leading)
                                Text(r.cancelReason ?? "—").foregroundColor(NFColor.ink3).frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .font(.system(size: 13)).monospacedDigit().padding(.horizontal, 14).frame(minHeight: 40)
                            .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                    table("注文履歴（直近20件）", empty: "注文履歴はありません", count: p.orders.count) {
                        ForEach(p.orders) { o in
                            HStack(spacing: 8) {
                                Text(NNoticeTime.fmt(o.openedAt)).frame(maxWidth: .infinity, alignment: .leading)
                                Text(o.storeName ?? "—").frame(maxWidth: .infinity, alignment: .leading)
                                Text(NT.yen(o.total)).frame(width: 100, alignment: .trailing)
                                Button("明細を見る") { onWeb("/app/orders/\(o.id)") }.font(.system(size: 12, weight: .bold)).frame(width: 90)
                            }
                            .font(.system(size: 13)).monospacedDigit().padding(.horizontal, 14).frame(minHeight: 40)
                            .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    // MARK: - 部品

    private func pill(_ icon: String, _ t: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) { Image(systemName: icon); Text(t) }
                .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle()).disabled(list.busy)
    }

    private func card<C: View>(_ title: String, action: (String, () -> Void)? = nil, @ViewBuilder _ c: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                if let action { Button(action.0) { action.1() }.font(.system(size: 13, weight: .bold)) }
            }
            c()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
    }

    private func kv(_ k: String, _ v: String?, danger: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
            Text(v?.nilIfEmpty ?? "—").font(.system(size: 14)).foregroundColor(danger && v?.nilIfEmpty != nil ? NFColor.danger : NFColor.navy)
        }
    }

    private func stat(_ label: String, _ value: String, tone: Color = NFColor.navy, sub: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
            Text(value).font(.system(size: 19, weight: .heavy)).monospacedDigit().foregroundColor(tone).lineLimit(1).minimumScaleFactor(0.7)
            if let sub { Text(sub).font(.system(size: 10.5)).foregroundColor(NFColor.ink3) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
    }

    private func table<C: View>(_ title: String, empty: String, count: Int, @ViewBuilder _ rows: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.system(size: 15, weight: .heavy)).foregroundColor(NFColor.navy).padding(14)
            if count == 0 {
                Text(empty).font(.system(size: 13)).foregroundColor(NFColor.ink3).frame(maxWidth: .infinity).padding(.vertical, 22)
                    .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
            } else { rows() }
        }
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.line, lineWidth: 1))
    }

    private func line(_ cols: [String], colors: [Color?] = []) -> some View {
        HStack(spacing: 8) {
            ForEach(Array(cols.enumerated()), id: \.offset) { i, t in
                Text(t).lineLimit(1).foregroundColor((i < colors.count ? colors[i] : nil) ?? NFColor.ink)
                    .frame(maxWidth: .infinity, alignment: i == 0 || (cols.count == 5 && (i == 1 || i == 4)) || (cols.count == 4 && i < 3) ? .leading : .trailing)
            }
        }
        .font(.system(size: 13)).monospacedDigit().padding(.horizontal, 14).frame(minHeight: 40)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    // MARK: - 読み込み・操作

    private func load() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "customer"), URLQueryItem(name: "id", value: id)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NCDPayload.self, from: data)
            loadError = nil
        } catch {
            loadError = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    private func recalc() async {
        if await list.act(["type": "customerRecalc", "id": id]) != nil { list.toast = "再計算しました"; await load() }
    }

    private func addNote() async {
        if await list.act(["type": "customerNote", "id": id, "body": noteText]) != nil {
            noteText = ""
            list.toast = "メモを追加しました"
            await load()
        }
    }
}

/// 属性の編集（Web の AttributesCard）
struct NCAttributesSheet: View {
    let c: NCDCustomer
    @ObservedObject var list: NativeCustomersModel
    let onDone: (Bool) -> Void
    @State private var allergy = ""
    @State private var dislike = ""
    @State private var preference = ""
    @State private var seat = ""
    @State private var anniversary = ""
    @State private var service = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("属性を編集").font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                Button { onDone(false) } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 36, height: 36) }
            }.padding(20)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    area("アレルギー", $allergy); area("苦手", $dislike); area("好み", $preference)
                    area("席の希望", $seat); area("記念日", $anniversary); area("接客メモ", $service)
                }.padding(.horizontal, 20)
            }
            HStack {
                Spacer()
                Button("キャンセル") { onDone(false) }.font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2).padding(.horizontal, 10)
                Button {
                    Task {
                        let body: [String: Any] = ["type": "customerAttributes", "id": c.id, "allergyNote": allergy, "dislikeNote": dislike, "preferenceNote": preference, "seatPreference": seat, "anniversaryNote": anniversary, "serviceNote": service]
                        if await list.act(body) != nil { list.toast = "保存しました"; onDone(true) }
                    }
                } label: {
                    Text(list.busy ? "保存中…" : "保存する").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 18).frame(height: 42).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.iris))
                }.buttonStyle(PressableStyle()).disabled(list.busy)
            }.padding(20)
        }
        .frame(minWidth: 560, minHeight: 620)
        .onAppear {
            allergy = c.allergyNote ?? ""; dislike = c.dislikeNote ?? ""; preference = c.preferenceNote ?? ""
            seat = c.seatPreference ?? ""; anniversary = c.anniversaryNote ?? ""; service = c.serviceNote ?? ""
        }
    }

    private func area(_ label: String, _ b: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            TextField("", text: b, axis: .vertical).lineLimit(1...4).font(.system(size: 15)).padding(12)
                .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }
}

enum NNoticeTime {
    static func fmt(_ iso: String) -> String { NativeNoticesView.dateTime(iso) }
}

extension String {
    var nilIfEmpty: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self }
}
