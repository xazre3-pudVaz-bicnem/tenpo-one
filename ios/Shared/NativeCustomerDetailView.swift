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
struct NCDConsent: Codable, Identifiable, Hashable { var id: String { type }; let type: String; let label: String; let granted: Bool; let grantedAt: String? }
struct NCDRank: Codable, Hashable { let key: String; let label: String }
struct NCDMergeHit: Codable, Identifiable, Hashable { let id: String; let name: String; let phone: String?; let email: String?; let visitCount: Int; let totalSpent: Int }
struct NCDMergeSearch: Codable { let results: [NCDMergeHit] }
struct NCDPayload: Codable {
    let canWrite: Bool; let canDelete: Bool; let canAdjustPoints: Bool; let canExport: Bool; let canAnonymize: Bool
    let loyaltyEnabled: Bool; let memberRanks: [NCDRank]; let memberRankLabel: String?; let consents: [NCDConsent]; let allTags: [NCTag]
    let customer: NCDCustomer
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
    /// 詳細の「編集・その他」のダイアログ（Web の /app/customers/[id] のボタンと同じ）
    @State private var dialog: NCDDialog?
    @State private var tagCreating = false
    @State private var tagName = ""
    @State private var tagColor = Color(hex: 0xBC5940)

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { onBack() } label: {
                    HStack(spacing: 4) { Image(systemName: "chevron.left"); Text("顧客一覧へ戻る") }.font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.royal)
                }.buttonStyle(.plain)
                Spacer()
                if let p = payload {
                    let anon = p.customer.anonymized
                    if p.canWrite { pill("arrow.clockwise", "再計算") { Task { await recalc() } } }
                    if p.canExport { pill("square.and.arrow.down", "データ書き出し") { exportData(p) } }
                    if p.canDelete && !anon { pill("arrow.triangle.merge", "この顧客と統合") { dialog = .merge } }
                    if p.canWrite && !anon { pill("pencil", "編集") { dialog = .basic } }
                    if p.canAnonymize && !anon { pill("person.crop.circle.badge.xmark", "個人情報を匿名化") { dialog = .anonymize } }
                    if p.canDelete { pill("trash", "削除", danger: true) { dialog = .delete } }
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
        .overlay { dialogView }
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
            if p.canExport {
                Text("「データ書き出し」はお客様からの開示請求への対応を想定した機能です。基本情報・予約履歴・注文履歴・ポイント履歴を1つのCSVで出力します。")
                    .font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
            }

            HStack(alignment: .top, spacing: 14) {
                VStack(spacing: 14) {
                    card("基本情報") {
                        kv("電話番号", c.phone); kv("メールアドレス", c.email)
                        kv("誕生日", c.birthday.map(NPDate.slash))
                        kv("性別", c.gender == "male" ? "男性" : c.gender == "female" ? "女性" : c.gender == "other" ? "その他" : nil)
                        kv("住所", [c.postalCode.map { "〒\($0)" }, c.address].compactMap { $0 }.joined(separator: " ").nilIfEmpty)
                    }
                    card("ポイント・会員", action: p.canAdjustPoints ? ("手動調整", { dialog = .points }) : nil) {
                        HStack(alignment: .bottom) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("ポイント残高").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                                (Text("\(c.pointBalance)").font(.system(size: 28, weight: .heavy)).foregroundColor(NFColor.royal)
                                 + Text(" pt").font(.system(size: 14, weight: .medium)).foregroundColor(NFColor.ink3)).monospacedDigit()
                            }
                            Spacer()
                            if !p.loyaltyEnabled { NPBadge(text: "ポイント機能OFF", color: NFColor.ink3) }
                        }
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 4) {
                                    Text("会員番号").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                                    if p.canWrite { Button { dialog = .memberNo } label: { Image(systemName: "pencil").font(.system(size: 11)).foregroundColor(NFColor.ink3) }.buttonStyle(.plain) }
                                }
                                Text(c.memberNo?.nilIfEmpty ?? "—").font(.system(size: 14)).foregroundColor(NFColor.navy)
                            }.frame(maxWidth: .infinity, alignment: .leading)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("会員ランク").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                                if p.canWrite {
                                    Menu {
                                        ForEach(p.memberRanks, id: \.key) { r in Button(r.label) { Task { await setRank(r.key) } } }
                                    } label: {
                                        HStack(spacing: 4) { Text(p.memberRankLabel ?? "—"); Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)) }
                                            .font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.navy)
                                            .padding(.horizontal, 10).frame(height: 34)
                                            .background(RoundedRectangle(cornerRadius: 8).stroke(NFColor.line, lineWidth: 1))
                                    }.disabled(list.busy)
                                } else {
                                    Text(p.memberRankLabel ?? "—").font(.system(size: 14)).foregroundColor(NFColor.navy)
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }
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
                    tagsCard(p)
                    consentCard(p)
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

    private func pill(_ icon: String, _ t: String, danger: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) { Image(systemName: icon); Text(t) }
                .font(.system(size: 13, weight: .bold)).foregroundColor(danger ? .white : NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(danger ? NFColor.danger : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(danger ? Color.clear : NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle()).disabled(list.busy)
    }

    // MARK: - タグ・同意（Web の TagsEditor・ConsentPanel と同じ）

    private func tagsCard(_ p: NCDPayload) -> some View {
        let attachedIds = Set(p.tags.map(\.id))
        let available = p.allTags.filter { !attachedIds.contains($0.id) }
        return card("タグ") {
            NCFlow(spacing: 6) {
                if p.tags.isEmpty { Text("タグはまだありません").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                ForEach(p.tags) { t in
                    HStack(spacing: 4) {
                        Text(t.name)
                        if p.canWrite {
                            Button { Task { await tagAct("customerTagDetach", t.id) } } label: { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)) }.buttonStyle(.plain)
                        }
                    }
                    .font(.system(size: 12, weight: .bold)).foregroundColor(NCTone.hex(t.color))
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Capsule().fill(NCTone.hex(t.color).opacity(0.12)))
                }
            }
            if p.canWrite {
                Rectangle().fill(NFColor.line).frame(height: 1)
                if !available.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("既存のタグを付与").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                        Menu {
                            ForEach(available) { t in Button(t.name) { Task { await tagAct("customerTagAttach", t.id) } } }
                        } label: {
                            HStack { Text("選択してください").foregroundColor(NFColor.ink3); Spacer(); Image(systemName: "chevron.down").foregroundColor(NFColor.ink3) }
                                .font(.system(size: 14)).padding(.horizontal, 10).frame(height: 38)
                                .background(RoundedRectangle(cornerRadius: 8).stroke(NFColor.line, lineWidth: 1))
                        }.disabled(list.busy)
                    }
                }
                if tagCreating {
                    HStack(alignment: .bottom, spacing: 8) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("新しいタグ名").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                            TextField("VIP 等", text: $tagName).font(.system(size: 14)).padding(.horizontal, 10).frame(height: 38)
                                .background(RoundedRectangle(cornerRadius: 8).stroke(NFColor.line, lineWidth: 1))
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text("色").font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3)
                            ColorPicker("", selection: $tagColor, supportsOpacity: false).labelsHidden().frame(height: 38)
                        }
                        Button("作成") { Task { await createTag() } }.font(.system(size: 13, weight: .bold)).disabled(list.busy)
                        Button("取消") { tagCreating = false }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3).disabled(list.busy)
                    }
                } else {
                    pill("plus", "新しいタグを作成") { tagCreating = true }
                }
            }
        }
    }

    private func consentCard(_ p: NCDPayload) -> some View {
        card("同意状態") {
            ForEach(p.consents) { cs in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cs.label).font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.navy)
                        Text(cs.granted ? "同意済み（\(cs.grantedAt.map { NPDate.slash(NNDateOnly.jst($0)) } ?? "—")）" : "未同意").font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
                    }
                    Spacer()
                    Toggle("", isOn: Binding(get: { cs.granted }, set: { v in Task { await setConsent(cs.type, v) } }))
                        .labelsHidden().tint(NFColor.iris).disabled(!p.canWrite || list.busy)
                }
                if cs.type != p.consents.last?.type { Rectangle().fill(NFColor.line).frame(height: 1) }
            }
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "info.circle").font(.system(size: 12))
                Text("配信同意のない顧客へはメッセージを送信できません。").font(.system(size: 12))
            }
            .foregroundColor(NFColor.saffron).padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 8).fill(NFColor.saffronSoft))
        }
    }

    // MARK: - ダイアログ

    @ViewBuilder private var dialogView: some View {
        if let d = dialog, let p = payload {
            switch d {
            case .basic:
                NativeModalCard(width: 640) { NCDBasicForm(c: p.customer, list: list, onClose: { dialog = nil }, onSaved: { Task { await load() } }) }
            case .memberNo:
                NativeModalCard(width: 480) { NCDMemberNoForm(c: p.customer, list: list, onClose: { dialog = nil }, onSaved: { Task { await load() } }) }
            case .points:
                NativeModalCard(width: 520) { NCDPointsForm(id: id, list: list, onClose: { dialog = nil }, onSaved: { Task { await load() } }) }
            case .merge:
                NativeModalCard(width: 640) { NCDMergeForm(id: id, name: p.customer.name, list: list, onClose: { dialog = nil }, onSaved: { Task { await load() } }) }
            case .anonymize:
                NativeModalCard(width: 560) {
                    NCDReasonForm(list: list, title: "個人情報を匿名化", message: "「\(p.customer.name)」の氏名・連絡先・住所・生年月日・自由記述メモ等を匿名化します。来店・注文・ポイント等の取引実績は保持されますが、この操作は取り消せません。",
                                  okText: "匿名化する", request: ["type": "customerAnonymize", "id": id], done: "顧客情報を匿名化しました", onClose: { dialog = nil }, onDone: { Task { await load() } })
                }
            case .delete:
                NativeModalCard(width: 560) {
                    NCDReasonForm(list: list, title: "顧客を削除", message: "「\(p.customer.name)」を削除します。この操作は履歴に記録され、一覧・検索から除外されます。",
                                  okText: "削除する", request: ["type": "customerDelete", "id": id], done: "顧客を削除しました", onClose: { dialog = nil }, onDone: { onBack() })
                }
            }
        }
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

    private func setRank(_ rank: String) async {
        if await list.act(["type": "customerMemberRank", "id": id, "rank": rank]) != nil { list.toast = "会員ランクを更新しました"; await load() }
    }

    private func setConsent(_ type: String, _ granted: Bool) async {
        if await list.act(["type": "customerConsent", "id": id, "consentType": type, "granted": granted]) != nil {
            list.toast = granted ? "同意を記録しました" : "同意を取り消しました"
            await load()
        }
    }

    private func tagAct(_ type: String, _ tagId: String) async {
        if await list.act(["type": type, "id": id, "tagId": tagId]) != nil { await load() }
    }

    private func createTag() async {
        let name = tagName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { list.error = "タグ名を入力してください"; return }
        if await list.act(["type": "customerTagCreate", "id": id, "name": name, "color": NCDColor.hex(tagColor)]) != nil {
            list.toast = "タグを作成して付与しました"
            tagName = ""; tagCreating = false
            await load()
        }
    }

    /// 開示請求向けのデータ書き出し（Web の /app/customers/[id]/export と同じ CSV を共有から保存）
    private func exportData(_ p: NCDPayload) {
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/customers/\(id)/export")
                if let url = NLShare.tempFile("customer_\(id.prefix(8))_\(NPDate.str(Date())).csv", data: data) { NLShare.present(url: url) }
            } catch { list.error = (error as? NativeAPIError)?.message ?? "書き出せませんでした" }
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

enum NCDDialog: Identifiable { case basic, memberNo, points, merge, anonymize, delete; var id: Int { hashValue } }

enum NCDColor {
    /// SwiftUI の色 → #rrggbb
    static func hex(_ c: Color) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(c).getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
    }
}

/// 送って、失敗したら文言を返す（ダイアログの中に出す。成功なら nil）
@MainActor private func ncdAct(_ list: NativeCustomersModel, _ body: [String: Any]) async -> String? {
    if await list.act(body) != nil { return nil }
    let e = list.error ?? "うまくいきませんでした"
    list.error = nil
    return e
}

/// 基本情報を編集（Web の EditCustomerDialog と同じ）
struct NCDBasicForm: View {
    let c: NCDCustomer
    @ObservedObject var list: NativeCustomersModel
    let onClose: () -> Void
    let onSaved: () -> Void
    @State private var name = ""
    @State private var kana = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var birthday = ""
    @State private var gender = ""
    @State private var postal = ""
    @State private var address = ""
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "基本情報を編集", onClose: onClose)
            NIField(label: "名前 *", text: $name)
            NIField(label: "フリガナ", text: $kana)
            HStack(spacing: 12) { NIField(label: "電話番号", text: $phone); NIField(label: "メールアドレス", text: $email) }
            HStack(alignment: .bottom, spacing: 12) {
                NUDateField(label: "誕生日", value: $birthday)
                VStack(alignment: .leading, spacing: 5) {
                    Text("性別").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                    NIChoice(options: [("", "未設定"), ("male", "男性"), ("female", "女性"), ("other", "その他")], value: $gender)
                }
            }
            HStack(spacing: 12) { NIField(label: "郵便番号", text: $postal, placeholder: "123-4567"); NIField(label: "住所", text: $address) }
            NIDialogFoot(error: error, busy: list.busy, okText: "保存する", busyText: "保存中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear {
            guard !loaded else { return }
            loaded = true
            name = c.name; kana = c.nameKana ?? ""; phone = c.phone ?? ""; email = c.email ?? ""; birthday = c.birthday ?? ""
            gender = c.gender ?? ""; postal = c.postalCode ?? ""; address = c.address ?? ""
        }
    }

    private func save() async {
        error = nil
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { error = "名前を入力してください"; return }
        let body: [String: Any] = ["type": "customerBasic", "id": c.id, "name": name, "nameKana": kana, "phone": phone, "email": email, "birthday": birthday, "gender": gender, "postalCode": postal, "address": address]
        if let e = await ncdAct(list, body) { error = e } else { list.toast = "基本情報を更新しました"; onClose(); onSaved() }
    }
}

/// 会員番号を編集
struct NCDMemberNoForm: View {
    let c: NCDCustomer
    @ObservedObject var list: NativeCustomersModel
    let onClose: () -> Void
    let onSaved: () -> Void
    @State private var memberNo = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "会員番号を編集", onClose: onClose)
            NIField(label: "会員番号", text: $memberNo, placeholder: "M-000123")
            NIDialogFoot(error: error, busy: list.busy, okText: "保存する", busyText: "保存中…", onCancel: onClose) {
                Task { if let e = await ncdAct(list, ["type": "customerMemberNo", "id": c.id, "memberNo": memberNo]) { error = e } else { list.toast = "会員番号を更新しました"; onClose(); onSaved() } }
            }
        }
        .padding(22)
        .onAppear { memberNo = c.memberNo ?? "" }
    }
}

/// ポイントを手動調整（付与・減算・理由必須）
struct NCDPointsForm: View {
    let id: String
    @ObservedObject var list: NativeCustomersModel
    let onClose: () -> Void
    let onSaved: () -> Void
    @State private var add = true
    @State private var amount = ""
    @State private var reason = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "ポイントを手動調整", onClose: onClose)
            HStack(spacing: 8) {
                dirButton("plus", "付与", on: add, tone: NFColor.iris) { add = true }
                dirButton("minus", "減算", on: !add, tone: NFColor.danger) { add = false }
            }
            NIField(label: "ポイント数", text: $amount, number: true)
            NIField(label: "理由（必須・履歴に記録されます）", text: $reason, placeholder: "ポイントカード移行分の手動付与 等")
            NIDialogFoot(error: error, busy: list.busy, okText: "調整する", busyText: "処理中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
    }
    private func dirButton(_ icon: String, _ text: String, on: Bool, tone: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) { Image(systemName: icon); Text(text) }
                .font(.system(size: 15, weight: .bold)).foregroundColor(on ? tone : NFColor.ink2)
                .frame(maxWidth: .infinity).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 10).fill(on ? tone.opacity(0.1) : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? tone : NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle())
    }
    private func save() async {
        error = nil
        guard let n = NI.num(amount), n > 0 else { error = "増減ポイントを入力してください"; return }
        guard !reason.trimmingCharacters(in: .whitespaces).isEmpty else { error = "理由を入力してください"; return }
        let delta = Int(n.rounded()) * (add ? 1 : -1)
        if let e = await ncdAct(list, ["type": "customerPoints", "id": id, "delta": delta, "reason": reason]) { error = e } else { list.toast = "ポイントを調整しました"; onClose(); onSaved() }
    }
}

/// 重複顧客と統合（電話番号で探す → 選ぶ → 統合）
struct NCDMergeForm: View {
    let id: String
    let name: String
    @ObservedObject var list: NativeCustomersModel
    let onClose: () -> Void
    let onSaved: () -> Void
    @State private var phone = ""
    @State private var results: [NCDMergeHit] = []
    @State private var searched = false
    @State private var selected: String?
    @State private var searching = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: "重複顧客と統合", onClose: onClose)
            Text("電話番号で検索し、「\(name)」に統合する顧客を選択してください。統合先の予約・注文・ポイント履歴は「\(name)」に引き継がれ、選択した顧客は削除扱いになります。")
                .font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .bottom, spacing: 8) {
                NIField(label: "電話番号", text: $phone, placeholder: "090-1234-5678")
                niSmallButton("検索", icon: "magnifyingglass") { Task { await search() } }.frame(height: 46).disabled(searching || phone.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            if searched && results.isEmpty { Text("該当する顧客が見つかりませんでした").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
            ForEach(results) { r in
                Button { selected = r.id } label: {
                    HStack {
                        Image(systemName: selected == r.id ? "largecircle.fill.circle" : "circle").foregroundColor(selected == r.id ? NFColor.iris : NFColor.ink3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.name).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.navy)
                            Text("\(r.phone ?? "—")｜\(r.email ?? "—")｜来店\(r.visitCount)回｜\(NT.yen(r.totalSpent))").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        Spacer()
                        NPBadge(text: "統合される", color: NFColor.ink3)
                    }
                    .padding(10)
                    .background(RoundedRectangle(cornerRadius: 10).fill(selected == r.id ? NFColor.irisSoft.opacity(0.5) : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected == r.id ? NFColor.iris : NFColor.line, lineWidth: 1))
                }.buttonStyle(.plain)
            }
            NIDialogFoot(error: error, busy: list.busy, okText: "統合する", busyText: "統合中…", danger: true, onCancel: onClose) { Task { await merge() } }
        }
        .padding(22)
    }

    private func search() async {
        searching = true
        defer { searching = false }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "customerMergeSearch"), URLQueryItem(name: "phone", value: phone), URLQueryItem(name: "exclude", value: id)]
        do {
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            results = try JSONDecoder().decode(NCDMergeSearch.self, from: data).results
            selected = nil; searched = true
        } catch { self.error = (error as? NativeAPIError)?.message ?? "検索に失敗しました" }
    }

    private func merge() async {
        guard let sel = selected else { error = "統合する顧客を選んでください"; return }
        if let e = await ncdAct(list, ["type": "customerMerge", "id": id, "mergeIds": [sel]]) { error = e } else { list.toast = "顧客を統合しました"; onClose(); onSaved() }
    }
}

/// 理由が要る確認（匿名化・削除）
struct NCDReasonForm: View {
    @ObservedObject var list: NativeCustomersModel
    let title: String
    let message: String
    let okText: String
    let request: [String: Any]
    let done: String
    let onClose: () -> Void
    let onDone: () -> Void
    @State private var reason = ""
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: title, onClose: onClose)
            Text(message).font(.system(size: 15)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
            NIField(label: "理由（必須）", text: $reason)
            NIDialogFoot(error: error, busy: list.busy, okText: okText, busyText: "処理中…", danger: true, onCancel: onClose) {
                Task {
                    let rs = reason.trimmingCharacters(in: .whitespaces)
                    guard !rs.isEmpty else { error = "理由を入力してください"; return }
                    var b = request; b["reason"] = rs
                    if let e = await ncdAct(list, b) { error = e } else { list.toast = done; onClose(); onDone() }
                }
            }
        }
        .padding(22)
    }
}
