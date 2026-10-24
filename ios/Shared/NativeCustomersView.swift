import SwiftUI

// 顧客台帳（ネイティブ）。Web の /app/customers（一覧）・/app/customers/[id]（詳細）と同じ（2026-10-24）
//   一覧：分類ごとの人数・検索・タグ・分類・並び・50件ずつ ／ 顧客を登録
//   詳細：自動分類・RFM・拡張、基本情報、ポイント、属性（編集）、接客メモ（追加）、タグ、実績・LTV・各履歴、再計算
//   RFM分析・重複候補・配信リスト・クーポン・CSV・統合・匿名化・削除・同意・ポイント調整は Web（ボタンで開く）

struct NCBadge: Codable, Hashable { let label: String; let tone: String }
struct NCTag: Codable, Hashable, Identifiable { let id: String; let name: String; let color: String }
struct NCSeg: Codable, Hashable { let key: String; let label: String; let count: Int? }
struct NCRow: Codable, Identifiable {
    let id: String; let name: String; let nameKana: String?; let phone: String?; let anonymized: Bool
    let badges: [NCBadge]; let moreCount: Int; let birthdayMonth: Bool; let rfm: NCBadge
    let visitCount: Int; let totalSpent: Int; let avgSpend: Int; let pointBalance: Int; let lastVisitAt: String?; let tags: [NCTag]
}
struct NCListPayload: Codable {
    let canView: Bool; let canWrite: Bool; let canExport: Bool; let canCoupons: Bool; let loyaltyEnabled: Bool
    let total: Int; let page: Int; let totalPages: Int; let q: String; let tag: String; let segment: String; let sort: String
    let tags: [NFNamed]; let segments: [NCSeg]; let extendedSegments: [NCSeg]; let rows: [NCRow]
}

enum NCTone {
    static func color(_ tone: String) -> Color {
        switch tone {
        case "primary": return NFColor.iris
        case "success": return Color(hex: 0x1E8F62)
        case "warning": return Color(hex: 0xC27C0E)
        case "danger": return NFColor.danger
        case "navy": return NFColor.navy
        default: return NFColor.ink3
        }
    }
    static func hex(_ s: String) -> Color {
        let h = s.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return NFColor.ink3 }
        return Color(hex: v)
    }
}

@MainActor
final class NativeCustomersModel: ObservableObject {
    @Published var payload: NCListPayload?
    @Published var q = ""
    @Published var tag = ""
    @Published var segment = ""
    @Published var sort = "last_visit_desc"
    @Published var page = 1
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [
                URLQueryItem(name: "part", value: "customers"), URLQueryItem(name: "q", value: q), URLQueryItem(name: "tag", value: tag),
                URLQueryItem(name: "segment", value: segment), URLQueryItem(name: "sort", value: sort), URLQueryItem(name: "page", value: String(page)),
            ]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NCListPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func act(_ body: [String: Any]) async -> NFActionResult? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return nil }
            return r
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

struct NativeCustomersView: View {
    @ObservedObject var model: NativeCustomersModel
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var openId: String?
    @State private var showCreate = false
    @State private var search = ""
    /// 顧客一覧・RFM分析・重複候補（Web の ?view=）
    @Binding var view: String
    /// 開いてほしい顧客（/app/customers/<id> から）
    @Binding var openRequest: String?

    private var p: NCListPayload? { model.payload }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                NativeTopBar(storeName: "", title: "顧客管理", subtitle: "Customers", onHome: onHome)
                if let p {
                    if !p.canView {
                        Spacer()
                        VStack(spacing: 6) {
                            Text("閲覧権限がありません").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.navy)
                            Text("顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        }
                        Spacer()
                    } else if view == "rfm" || view == "duplicates" {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 12) {
                                Text(view == "rfm" ? "企業内全店舗で共有される顧客台帳です" : "電話番号・メールアドレスが一致する重複候補です").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                                NCTabs(view: $view)
                                if view == "rfm" { NCRfmView(list: model, onOpen: { openId = $0 }) } else { NCDuplicatesView(list: model) }
                            }
                            .padding(16)
                        }
                    } else {
                        listBody(p)
                    }
                } else {
                    Spacer()
                    if let e = model.error {
                        VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await model.refresh() } } }
                    } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                    Spacer()
                }
            }
            .background(NFColor.lilac.ignoresSafeArea())
            if let id = openId {
                NativeCustomerDetailView(id: id, list: model, onBack: { openId = nil; Task { await model.refresh() } }, onWeb: onWeb)
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
            }
        }
        .animation(.easeOut(duration: 0.2), value: openId)
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task { search = model.q; await model.refresh() }
        .onAppear { if let r = openRequest { openId = r; openRequest = nil } }
        .onChange(of: openRequest) { r in if let r { openId = r; openRequest = nil } }
        .onChange(of: model.tag) { _ in model.page = 1; Task { await model.refresh() } }
        .onChange(of: model.segment) { _ in model.page = 1; Task { await model.refresh() } }
        .onChange(of: model.sort) { _ in model.page = 1; Task { await model.refresh() } }
        .sheet(isPresented: $showCreate) {
            NCCreateSheet(model: model) { newId in
                showCreate = false
                if let newId { openId = newId }
            }
        }
    }

    private func listBody(_ p: NCListPayload) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text("全\(p.total)件｜企業内全店舗で共有される顧客台帳です").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                    Spacer()
                    if p.canCoupons { webBtn("クーポン管理") { onWeb("/app/coupons") } }
                    if p.canExport { webBtn("CSV出力") { exportCsv() } }
                    if p.canWrite {
                        Button { showCreate = true } label: {
                            HStack(spacing: 5) { Image(systemName: "plus"); Text("顧客を登録") }
                                .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 14).frame(height: 38).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.iris))
                        }.buttonStyle(PressableStyle())
                    }
                }
                NCTabs(view: $view)
                NCFlow(spacing: 8) {
                    ForEach(p.segments, id: \.key) { s in
                        let on = model.segment == s.key
                        Button { model.segment = on ? "" : s.key } label: {
                            HStack(spacing: 6) { Text(s.label); Text("\(s.count ?? 0)").foregroundColor(NFColor.ink3).monospacedDigit() }
                                .font(.system(size: 13, weight: .semibold)).foregroundColor(on ? NFColor.royal : NFColor.ink2)
                                .padding(.horizontal, 12).frame(height: 34)
                                .background(RoundedRectangle(cornerRadius: 9).fill(on ? NFColor.lilacSoft : Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 9).stroke(on ? NFColor.iris : NFColor.line, lineWidth: 1))
                        }.buttonStyle(.plain)
                    }
                }
                filters(p)
                if p.rows.isEmpty {
                    let filtered = !p.q.isEmpty || !p.tag.isEmpty || !p.segment.isEmpty
                    VStack(spacing: 6) {
                        Text(filtered ? "条件に一致する顧客がいません" : "まだ顧客が登録されていません").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                        Text(filtered ? "検索条件やセグメント・タグ絞込を見直してください" : "「顧客を登録」から最初の顧客を追加できます").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                    }
                    .frame(maxWidth: .infinity).padding(36).background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                } else {
                    VStack(spacing: 0) {
                        header(p)
                        ForEach(p.rows) { r in row(r, p) }
                    }
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
                    if p.totalPages > 1 { pager(p) }
                }
            }
            .padding(16)
        }
    }

    private func filters(_ p: NCListPayload) -> some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundColor(NFColor.ink3)
                TextField("名前・フリガナ・電話番号", text: $search)
                    .submitLabel(.search)
                    .onSubmit { model.q = search; model.page = 1; Task { await model.refresh() } }
                if !search.isEmpty {
                    Button { search = ""; model.q = ""; model.page = 1; Task { await model.refresh() } } label: { Image(systemName: "xmark.circle.fill").foregroundColor(NFColor.ink3) }
                }
            }
            .font(.system(size: 15)).padding(.horizontal, 12).frame(height: 40).frame(maxWidth: 340)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
            picker("タグ", $model.tag, [("", "すべて")] + p.tags.map { ($0.id, $0.name) })
            picker("分類", $model.segment, [("", "すべて")] + p.segments.map { ($0.key, $0.label) } + p.extendedSegments.map { ($0.key, $0.label) })
            picker("並び", $model.sort, [("last_visit_desc", "最終来店が新しい順"), ("last_visit_asc", "最終来店が古い順"), ("total_spent_desc", "累計利用額が多い順"), ("visit_count_desc", "来店回数が多い順")])
            Spacer()
        }
    }

    private func picker(_ label: String, _ sel: Binding<String>, _ options: [(String, String)]) -> some View {
        HStack(spacing: 4) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            Picker("", selection: sel) { ForEach(options, id: \.0) { k, v in Text(v).tag(k) } }
                .pickerStyle(.menu).frame(height: 40)
                .padding(.horizontal, 2).background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private func webBtn(_ t: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
                .padding(.horizontal, 12).frame(height: 38)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle())
    }

    private func th(_ t: String, _ w: CGFloat? = nil, trailing: Bool = false) -> some View {
        Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            .frame(width: w, alignment: trailing ? .trailing : .leading).frame(maxWidth: w == nil ? .infinity : nil, alignment: trailing ? .trailing : .leading)
    }

    private func header(_ p: NCListPayload) -> some View {
        HStack(spacing: 10) {
            th("名前"); th("電話", 130); th("分類", 170); th("RFM", 70); th("来店回数", 70, trailing: true); th("累計利用額", 100, trailing: true); th("平均客単価", 90, trailing: true)
            if p.loyaltyEnabled { th("ポイント", 80, trailing: true) }
            th("最終来店", 92); th("タグ", 130)
        }
        .padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
    }

    private func row(_ r: NCRow, _ p: NCListPayload) -> some View {
        Button { openId = r.id } label: {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 5) {
                        Text(r.name).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy).lineLimit(1)
                        if r.anonymized { NPBadge(text: "匿名化済み", color: NFColor.ink3) }
                    }
                    if let k = r.nameKana { Text(k).font(.system(size: 11.5)).foregroundColor(NFColor.ink3).lineLimit(1) }
                }.frame(maxWidth: .infinity, alignment: .leading)
                Text(r.phone ?? "—").foregroundColor(NFColor.ink2).frame(width: 130, alignment: .leading)
                HStack(spacing: 4) {
                    if r.badges.isEmpty && !r.birthdayMonth { Text("—").foregroundColor(NFColor.ink3) }
                    ForEach(r.badges, id: \.self) { b in NPBadge(text: b.label, color: NCTone.color(b.tone)) }
                    if r.moreCount > 0 { NPBadge(text: "+\(r.moreCount)", color: NFColor.ink3) }
                    if r.birthdayMonth { NPBadge(text: "誕生月", color: NCTone.color("success")) }
                }.frame(width: 170, alignment: .leading)
                NPBadge(text: r.rfm.label, color: NCTone.color(r.rfm.tone)).frame(width: 70, alignment: .leading)
                Text("\(r.visitCount)回").frame(width: 70, alignment: .trailing)
                Text(NT.yen(r.totalSpent)).frame(width: 100, alignment: .trailing)
                Text(NT.yen(r.avgSpend)).frame(width: 90, alignment: .trailing)
                if p.loyaltyEnabled { Text("\(r.pointBalance)pt").frame(width: 80, alignment: .trailing) }
                Text(r.lastVisitAt.map { NPDate.slash(NNDateOnly.jst($0)) } ?? "—").foregroundColor(NFColor.ink2).frame(width: 92, alignment: .leading)
                HStack(spacing: 4) {
                    if r.tags.isEmpty { Text("—").foregroundColor(NFColor.ink3) }
                    ForEach(r.tags.prefix(2)) { t in NPBadge(text: t.name, color: NCTone.hex(t.color)) }
                }.frame(width: 130, alignment: .leading)
            }
            .font(.system(size: 13.5)).monospacedDigit().foregroundColor(NFColor.ink)
            .padding(.horizontal, 14).frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func pager(_ p: NCListPayload) -> some View {
        HStack {
            let from = (p.page - 1) * 50 + 1
            Text("\(p.total)件中 \(from)〜\(min(from + 49, p.total))件を表示\(p.segment.isEmpty ? "" : "（セグメント絞込は概数のため実表示件数と一致しない場合があります）")").font(.system(size: 12)).foregroundColor(NFColor.ink3)
            Spacer()
            Button("前へ") { model.page = max(1, p.page - 1); Task { await model.refresh() } }.disabled(p.page <= 1)
            Text("\(p.page) / \(p.totalPages) ページ").font(.system(size: 12)).foregroundColor(NFColor.ink3).padding(.horizontal, 8)
            Button("次へ") { model.page = min(p.totalPages, p.page + 1); Task { await model.refresh() } }.disabled(p.page >= p.totalPages)
        }
        .font(.system(size: 14, weight: .bold))
    }

    private func exportCsv() {
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/customers/export")
                if let url = NLShare.tempFile("customers_\(NPDate.str(Date())).csv", data: data) { NLShare.present(url: url) }
            } catch {
                model.error = (error as? NativeAPIError)?.message ?? "CSVを出せませんでした"
            }
        }
    }
}

/// 顧客を登録（Web の CreateCustomerDialog）
struct NCCreateSheet: View {
    @ObservedObject var model: NativeCustomersModel
    let onDone: (String?) -> Void
    @State private var name = ""
    @State private var kana = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var useBirthday = false
    @State private var birthday = Calendar.current.date(byAdding: .year, value: -30, to: Date()) ?? Date()
    @State private var allergy = ""
    @State private var preference = ""
    @State private var memo = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("顧客を登録").font(.system(size: 19, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                Button { onDone(nil) } label: { Image(systemName: "xmark").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink2).frame(width: 36, height: 36) }
            }.padding(20)
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    field("名前 *", "山田 太郎", $name)
                    field("フリガナ", "ヤマダ タロウ", $kana)
                    HStack(spacing: 12) {
                        field("電話番号", "090-1234-5678", $phone).keyboardType(.phonePad)
                        field("メールアドレス", "taro@example.com", $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    }
                    Toggle(isOn: $useBirthday) { Text("誕生日").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2) }.tint(NFColor.iris).frame(maxWidth: 240)
                    if useBirthday { DatePicker("", selection: $birthday, displayedComponents: .date).labelsHidden().environment(\.locale, Locale(identifier: "ja_JP")) }
                    area("アレルギー", "小麦・えび 等", $allergy)
                    area("好み", "辛い物が好き 等", $preference)
                    area("メモ", "接客上の申し送り事項", $memo)
                }.padding(.horizontal, 20)
            }
            HStack {
                Spacer()
                Button("キャンセル") { onDone(nil) }.font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2).padding(.horizontal, 10)
                Button { Task { await submit() } } label: {
                    Text(model.busy ? "登録中…" : "登録する").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 18).frame(height: 42).background(RoundedRectangle(cornerRadius: 10).fill(NFColor.iris))
                }.buttonStyle(PressableStyle()).disabled(model.busy)
            }.padding(20)
        }
        .frame(minWidth: 600, minHeight: 640)
    }

    private func field(_ label: String, _ ph: String, _ b: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            TextField(ph, text: b).font(.system(size: 16)).padding(.horizontal, 12).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }
    private func area(_ label: String, _ ph: String, _ b: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2)
            TextField(ph, text: b, axis: .vertical).lineLimit(2...4).font(.system(size: 15)).padding(12)
                .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private func submit() async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { model.error = "名前を入力してください"; return }
        let body: [String: Any] = [
            "type": "customerCreate", "name": name, "nameKana": kana, "phone": phone, "email": email,
            "birthday": useBirthday ? NPDate.str(birthday) : "", "allergyNote": allergy, "preferenceNote": preference, "serviceNote": memo,
        ]
        if let r = await model.act(body) {
            model.toast = "顧客を登録しました"
            await model.refresh()
            onDone(r.orderId)
        }
    }
}
