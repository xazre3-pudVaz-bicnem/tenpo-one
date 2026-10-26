import SwiftUI

// iPhone の店長・オーナー：顧客台帳（Web の /app/customers・/app/customers/[id] の代わり。2026-10-25 Ronnie「iPhone も native に」）。
// iPad の顧客台帳（NativeCustomersView・NativeCustomerDetailView）は使わない。iPhone の幅に合わせた 1 列の画面：
//   一覧：検索（名前・フリガナ・電話番号）・分類のチップ（人数つき）・タグ・並び・お客様のカード（来店回数・累計・最終来店・分類・RFM・タグ）
//         下まで行くと次の 50 件・＋顧客を登録
//   詳細：自動分類・RFM・拡張、来店回数・累計利用額・平均客単価・最終来店から・予約回数・キャンセル、連絡先（押すと電話・メール）、
//         属性（アレルギー・苦手・好み・席の希望・記念日・接客メモ。編集）、接客メモ（追加）、タグ（付ける・外す）、
//         予約履歴（押すと店舗台帳のその予約）・注文履歴（押すと伝票）・よく注文する商品・利用店舗・LTV・再計算
// サーバーは iPad と同じ（返す形は変えない。iPad がそのまま使っている）:
//   GET  ?part=customers&q=&tag=&segment=&sort=&page=   … 一覧（NCListPayload）
//   GET  ?part=customer&id=                              … 詳細（NCDPayload）
//   POST customerCreate / customerAttributes / customerNote / customerTagAttach / customerTagDetach / customerRecalc
//   （権限はサーバーが Web と同じに見る：見る＝customers.view、変える＝customers.write）
// RFM分析・重複候補・CSV・統合・匿名化・削除・同意・ポイント調整・会員番号／ランク・基本情報の編集は Web（PC の管理画面）のまま。

// MARK: - データと動き

@MainActor
final class NPOCustomersModel: ObservableObject {
    @Published var payload: NCListPayload?
    /// 読んだところまでのお客様（下まで行くと次の 50 件を足す）
    @Published var rows: [NCRow] = []
    @Published var q = ""
    @Published var tag = ""
    @Published var segment = ""
    @Published var sort = "last_visit_desc"
    @Published var loadingMore = false
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    /// サーバーが「Web で見せて」と返した（機能がオフなど）。画面を閉じて裏の Web を見せる
    @Published var useWeb = false
    /// 見本（シミュレーターの確認用）。通信しない
    var isSample = false

    static let sorts: [(key: String, label: String)] = [
        ("last_visit_desc", "最終来店が新しい順"),
        ("last_visit_asc", "最終来店が古い順"),
        ("total_spent_desc", "累計利用額が多い順"),
        ("visit_count_desc", "来店回数が多い順"),
    ]

    init() {
        // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す）
        if let c = NativeAPI.cached(NCListPayload.self, NativeModuleAPI.url("customers", Self.query(q: "", tag: "", segment: "", sort: "last_visit_desc", page: 1))) {
            payload = c
            rows = c.rows
        }
    }

    static func query(q: String, tag: String, segment: String, sort: String, page: Int) -> [String: String] {
        ["q": q, "tag": tag, "segment": segment, "sort": sort, "page": String(page)]
    }

    private func current(page: Int = 1) -> [String: String] {
        Self.query(q: q, tag: tag, segment: segment, sort: sort, page: page)
    }

    var filtered: Bool { !q.isEmpty || !tag.isEmpty || !segment.isEmpty }

    /// 1 ページ目から読み直す（検索・絞り込み・並びを変えたとき・引っ張って更新）
    func refresh() async {
        guard !isSample else { return }
        let asked = current()
        if payload?.q != q || payload?.tag != tag || payload?.segment != segment || payload?.sort != sort,
           let c = NativeAPI.cached(NCListPayload.self, NativeModuleAPI.url("customers", asked)) {
            payload = c
            rows = c.rows
        }
        do {
            let p = try await NativeModuleAPI.get(NCListPayload.self, part: "customers", query: asked)
            // 読んでいる間に条件を変えたら、古い返事は使わない
            guard asked == current() else { return }
            payload = p
            rows = p.rows
            error = nil
        } catch {
            guard asked == current() else { return }
            let e = error as? NativeAPIError
            if e?.useWeb == true && payload == nil { useWeb = true }
            self.error = e?.message ?? "通信できませんでした"
        }
    }

    /// 次の 50 件
    func loadMore() async {
        guard !isSample, !loadingMore, let p = payload, p.page < p.totalPages else { return }
        loadingMore = true
        defer { loadingMore = false }
        let asked = current(page: p.page + 1)
        do {
            let next = try await NativeModuleAPI.get(NCListPayload.self, part: "customers", query: asked)
            guard asked == current(page: p.page + 1) else { return }
            payload = next
            let have = Set(rows.map(\.id))
            rows += next.rows.filter { !have.contains($0.id) }
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "続きを読めませんでした"
        }
    }

    /// 操作（POST）。うまくいかなければそのことば（うまくいったら nil。知らせを出す）
    func act(_ body: [String: Any], done: String) async -> String? {
        if isSample {
            toast = done
            return nil
        }
        busy = true
        defer { busy = false }
        let r = await NSPApi.postJSON(body)
        guard r.ok else { return r.error ?? "うまくいきませんでした" }
        toast = done
        return nil
    }
}

/// 日付の言い方（顧客の画面）
enum NPOCustomerText {
    /// ISO → 「2026/10/18」
    static func day(_ iso: String?) -> String {
        guard let iso, !iso.isEmpty else { return "—" }
        return NPDate.slash(NNDateOnly.jst(iso))
    }
}

// MARK: - 一覧

struct NPOCustomersView: View {
    @ObservedObject var model: NPOCustomersModel
    let onBack: () -> Void
    /// Web の画面を開く（伝票の明細・店舗台帳のその予約など）
    let onWeb: (String) -> Void
    /// 見本（シミュレーター）：開いた詳細に出す中身
    let sampleDetail: NCDPayload?
    @State private var search = ""
    @State private var openId: String? = nil
    @State private var createOpen = false

    init(model: NPOCustomersModel, onBack: @escaping () -> Void, onWeb: @escaping (String) -> Void, openId: String? = nil, sampleDetail: NCDPayload? = nil) {
        self.model = model
        self.onBack = onBack
        self.onWeb = onWeb
        self.sampleDetail = sampleDetail
        _openId = State(initialValue: openId)
    }

    private var subtitle: String {
        guard let p = model.payload, p.canView else { return "" }
        return "全\(p.total)件・全店舗で共有"
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            NPOFrame(title: "顧客", subtitle: subtitle, onBack: onBack) {
                topButtons
            } content: {
                main
            }
            if let id = openId {
                NPOCustomerDetail(id: id, list: model, sample: sampleDetail, onBack: {
                    openId = nil
                    Task { await model.refresh() }
                }, onWeb: onWeb)
                .transition(.move(edge: .trailing))
                .zIndex(1)
            }
            NPHToast(text: $model.toast).zIndex(2)
        }
        .environment(\.colorScheme, .light)
        .animation(.easeOut(duration: 0.2), value: openId)
        .animation(.easeOut(duration: 0.18), value: model.toast)
        .task {
            search = model.q
            await model.refresh()
        }
        .sheet(isPresented: $createOpen) {
            NPOCustomerCreateSheet(model: model) { newId in
                createOpen = false
                if let newId { openId = newId }
            }
            .presentationDetents([.large])
            .environment(\.colorScheme, .light)
        }
    }

    private var topButtons: some View {
        HStack(spacing: 0) {
            Button { Task { await model.refresh() } } label: {
                Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 38, height: 40)
            }
            .accessibilityLabel("更新")
            if model.payload?.canWrite ?? false {
                Button { createOpen = true } label: {
                    VStack(spacing: 1) {
                        Image(systemName: "person.badge.plus").font(.system(size: 16, weight: NT.strong))
                        Text("顧客登録").font(.system(size: 9.5, weight: NT.strong)).lineLimit(1)
                    }
                    .foregroundColor(.white).frame(width: 52, height: 44)
                }
                .buttonStyle(PressableStyle())
                .accessibilityLabel("顧客を登録")
            }
        }
    }

    @ViewBuilder private var main: some View {
        if let p = model.payload {
            if !p.canView {
                VStack(spacing: 8) {
                    Spacer()
                    Image(systemName: "lock").font(.system(size: 28, weight: .semibold)).foregroundColor(NT.ink3)
                    Text("閲覧権限がありません").font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink)
                    Text("顧客情報の閲覧には権限が必要です。管理者にお問い合わせください。").font(.system(size: 13)).foregroundColor(NT.ink3)
                        .multilineTextAlignment(.center).padding(.horizontal, 28)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                list(p)
            }
        } else if let e = model.error {
            VStack(spacing: 14) {
                Spacer()
                Image(systemName: "exclamationmark.circle").font(.system(size: 30, weight: .semibold)).foregroundColor(NT.ink3)
                Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center).padding(.horizontal, 28)
                Button { Task { await model.refresh() } } label: {
                    Text("もう一度読む").font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 22).frame(height: 44)
                        .background(Capsule().fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
                Spacer()
            }
            .frame(maxWidth: .infinity)
        } else {
            VStack { Spacer(); ProgressView().tint(NT.purple); Spacer() }.frame(maxWidth: .infinity)
        }
    }

    private func list(_ p: NCListPayload) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                searchBar
                segmentChips(p)
                filterRow(p)
                if let e = model.error {
                    Text(e).font(.system(size: 12, weight: .bold)).foregroundColor(NT.danger)
                        .frame(maxWidth: .infinity).padding(.vertical, 6).background(RoundedRectangle(cornerRadius: 8).fill(NT.dangerBg))
                }
                HStack(spacing: 6) {
                    Text("\(p.total)件").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    Text(sortLabel).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                    Spacer()
                }
                .padding(.horizontal, 4)
                if model.rows.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "person.2").font(.system(size: 28, weight: .semibold)).foregroundColor(NT.ink3)
                        Text(model.filtered ? "条件に一致する顧客がいません" : "まだ顧客が登録されていません").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                        Text(model.filtered ? "検索や分類・タグを見直してください" : "右上の「顧客登録」から追加できます").font(.system(size: 12)).foregroundColor(NT.ink3)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 36)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
                }
                ForEach(model.rows) { r in
                    Button { openId = r.id } label: { rowCard(r, p) }
                        .buttonStyle(PressableStyle(scale: 0.985))
                        .onAppear {
                            // 下まで来たら次の 50 件
                            if r.id == model.rows.last?.id { Task { await model.loadMore() } }
                        }
                }
                if model.loadingMore {
                    ProgressView().tint(NT.purple).frame(maxWidth: .infinity).padding(.vertical, 12)
                } else if p.page < p.totalPages {
                    Button { Task { await model.loadMore() } } label: {
                        Text("続きを読む").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.purple)
                            .frame(maxWidth: .infinity).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    }
                    .buttonStyle(PressableStyle())
                }
                Text("RFM分析・重複候補・CSV出力・クーポンは PC の管理画面（顧客管理）から。").font(.system(size: 11)).foregroundColor(NT.ink3)
                    .frame(maxWidth: .infinity).multilineTextAlignment(.center).padding(.top, 4)
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.refresh() }
    }

    private var sortLabel: String {
        NPOCustomersModel.sorts.first(where: { $0.key == model.sort })?.label ?? ""
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.ink3)
            TextField("名前・フリガナ・電話番号で探す", text: $search)
                .font(.system(size: 16)).foregroundColor(NT.ink)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .onSubmit { apply { model.q = search.trimmingCharacters(in: .whitespaces) } }
            if !search.isEmpty {
                Button {
                    search = ""
                    apply { model.q = "" }
                } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundColor(NT.ink3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("検索を消す")
            }
        }
        .padding(.horizontal, 12).frame(height: 46)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    /// 条件を変えて 1 ページ目から読み直す
    private func apply(_ change: () -> Void) {
        change()
        Task { await model.refresh() }
    }

    /// 分類のチップ（すべて・新規・リピーター・常連・VIP・休眠 …。人数は企業の全顧客）
    private func segmentChips(_ p: NCListPayload) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                chip("すべて", count: nil, on: model.segment.isEmpty) { apply { model.segment = "" } }
                ForEach(p.segments, id: \.key) { s in
                    chip(s.label, count: s.count, on: model.segment == s.key) { apply { model.segment = model.segment == s.key ? "" : s.key } }
                }
                ForEach(p.extendedSegments, id: \.key) { s in
                    chip(s.label, count: s.count, on: model.segment == s.key) { apply { model.segment = model.segment == s.key ? "" : s.key } }
                }
            }
            .padding(.horizontal, 2).padding(.vertical, 1)
        }
    }

    private func chip(_ label: String, count: Int?, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(label).font(.system(size: 13, weight: NT.strong)).lineLimit(1)
                if let count { Text("\(count)").font(.system(size: 12, weight: NT.strong)).monospacedDigit().opacity(0.75) }
            }
            .foregroundColor(on ? .white : NT.ink2)
            .padding(.horizontal, 12).frame(height: 36)
            .background(Capsule().fill(on ? NT.purple : Color.white))
            .overlay(Capsule().stroke(on ? Color.clear : NT.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// タグ・並び
    private func filterRow(_ p: NCListPayload) -> some View {
        HStack(spacing: 8) {
            if !p.tags.isEmpty {
                Menu {
                    Button("すべてのタグ") { apply { model.tag = "" } }
                    ForEach(p.tags) { t in
                        Button(t.name) { apply { model.tag = t.id } }
                    }
                } label: {
                    menuLabel("tag", p.tags.first(where: { $0.id == model.tag })?.name ?? "タグ", on: !model.tag.isEmpty)
                }
            }
            Menu {
                ForEach(NPOCustomersModel.sorts, id: \.key) { s in
                    Button(s.label) { apply { model.sort = s.key } }
                }
            } label: {
                menuLabel("arrow.up.arrow.down", sortLabel, on: false)
            }
        }
    }

    private func menuLabel(_ icon: String, _ text: String, on: Bool) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 12, weight: .bold))
            Text(text).font(.system(size: 13, weight: NT.strong)).lineLimit(1)
            Spacer(minLength: 2)
            Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
        }
        .foregroundColor(on ? NT.purpleDeep : NT.ink2)
        .padding(.horizontal, 12).frame(maxWidth: .infinity).frame(height: 40)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? NT.lilac : Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? NT.purple : NT.line, lineWidth: 1))
    }

    /// お客様のカード（名前・フリガナ・電話／来店回数・累計・最終来店／分類・誕生月・タグ）
    private func rowCard(_ r: NCRow, _ p: NCListPayload) -> some View {
        let sub = [r.nameKana, r.phone].compactMap { $0?.nilIfEmpty }.joined(separator: "・")
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .center, spacing: 6) {
                Text(r.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                if r.anonymized { NPBadge(text: "匿名化済み", color: NT.ink3) }
                Spacer(minLength: 4)
                NPBadge(text: r.rfm.label, color: NCTone.color(r.rfm.tone))
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            }
            if !sub.isEmpty {
                Text(sub).font(.system(size: 12)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1)
            }
            HStack(spacing: 0) {
                stat("来店", "\(r.visitCount)回")
                stat("累計", NT.yen(r.totalSpent))
                stat("最終来店", NPOCustomerText.day(r.lastVisitAt))
                if p.loyaltyEnabled { stat("ポイント", "\(r.pointBalance)pt") }
            }
            if !r.badges.isEmpty || r.birthdayMonth || !r.tags.isEmpty {
                WrapLayout(spacing: 4) {
                    ForEach(r.badges, id: \.self) { b in NPBadge(text: b.label, color: NCTone.color(b.tone)) }
                    if r.moreCount > 0 { NPBadge(text: "+\(r.moreCount)", color: NT.ink3) }
                    if r.birthdayMonth { NPBadge(text: "誕生月", color: NCTone.color("success")) }
                    ForEach(r.tags) { t in NPBadge(text: "#\(t.name)", color: NCTone.hex(t.color)) }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.system(size: 10, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1)
            Text(value).font(.system(size: 13.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - 詳細

struct NPOCustomerDetail: View {
    let id: String
    @ObservedObject var list: NPOCustomersModel
    /// 見本（シミュレーター）の中身。あれば通信しない
    let sample: NCDPayload?
    let onBack: () -> Void
    let onWeb: (String) -> Void

    @State private var payload: NCDPayload? = nil
    @State private var loadError: String? = nil
    @State private var noteText = ""
    @State private var attrsOpen = false
    @State private var problem: String? = nil

    init(id: String, list: NPOCustomersModel, sample: NCDPayload? = nil, onBack: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.id = id
        self.list = list
        self.sample = sample
        self.onBack = onBack
        self.onWeb = onWeb
        _payload = State(initialValue: sample ?? NativeAPI.cached(NCDPayload.self, NativeModuleAPI.url("customer", ["id": id])))
    }

    var body: some View {
        VStack(spacing: 0) {
            NPHTopBar(title: payload?.customer.name ?? "顧客", subtitle: "顧客台帳", backLabel: "顧客", onBack: onBack) {
                Button { Task { await load() } } label: {
                    Image(systemName: "arrow.clockwise").font(.system(size: 16, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 40)
                }
                .accessibilityLabel("更新")
            }
            if let problem {
                Text(problem).font(.system(size: 12, weight: .bold)).foregroundColor(NT.danger).multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity).padding(.horizontal, 12).padding(.vertical, 6).background(NT.dangerBg)
            }
            if let p = payload {
                ScrollView { content(p) }
                    .scrollDismissesKeyboard(.interactively)
                    .refreshable { await load() }
            } else if let e = loadError {
                VStack(spacing: 14) {
                    Spacer()
                    Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink2).multilineTextAlignment(.center).padding(.horizontal, 28)
                    Button { Task { await load() } } label: {
                        Text("もう一度読む").font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                            .padding(.horizontal, 22).frame(height: 44)
                            .background(Capsule().fill(NT.purple))
                    }
                    .buttonStyle(PressableStyle())
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                VStack { Spacer(); ProgressView().tint(NT.purple); Spacer() }.frame(maxWidth: .infinity)
            }
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
        .task { await load() }
        .sheet(isPresented: $attrsOpen) {
            if let p = payload {
                NPOCustomerAttrsSheet(c: p.customer, list: list) { saved in
                    attrsOpen = false
                    if saved { Task { await load() } }
                }
                .presentationDetents([.large])
                .environment(\.colorScheme, .light)
            }
        }
    }

    private func content(_ p: NCDPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            headerCard(p)
            statsGrid(p)
            contactCard(p)
            attrsCard(p)
            notesCard(p)
            tagsCard(p)
            reservationsCard(p)
            ordersCard(p)
            if !p.topProducts.isEmpty {
                card("よく注文する商品", en: "Top 5") {
                    ForEach(p.topProducts, id: \.self) { x in
                        line(x.name, "\(x.quantity)点", NT.yen(x.amount))
                    }
                }
            }
            if !p.stores.isEmpty {
                card("利用店舗", en: "Stores") {
                    ForEach(p.stores) { s in line(s.storeName, "\(s.visitCount)回", NT.yen(s.totalSpent)) }
                }
            }
            ltvCard(p)
            if p.canWrite {
                Button { Task { await act(["type": "customerRecalc", "id": id], done: "再計算しました") } } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "arrow.clockwise")
                        Text("来店回数・累計を再計算")
                    }
                    .font(.system(size: 13, weight: NT.strong)).foregroundColor(NT.ink2)
                    .frame(maxWidth: .infinity).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(list.busy)
            }
            Text("基本情報・会員番号・ランク・ポイントの調整・同意・統合・匿名化・削除・データ書き出しは PC の管理画面（顧客管理）から。")
                .font(.system(size: 11)).foregroundColor(NT.ink3).frame(maxWidth: .infinity).multilineTextAlignment(.center)
        }
        .padding(.horizontal, 12).padding(.top, 12).padding(.bottom, 40)
    }

    // MARK: 名前・分類

    private func headerCard(_ p: NCDPayload) -> some View {
        let c = p.customer
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(c.name).font(.system(size: 22, weight: NT.strong)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                if c.anonymized { NPBadge(text: "匿名化済み", color: NT.ink3) }
            }
            Text("登録日 \(NPOCustomerText.day(c.createdAt))\(c.nameKana.map { "｜\($0)" } ?? "")").font(.system(size: 12)).foregroundColor(NT.ink3)
            WrapLayout(spacing: 5) {
                ForEach(p.segments, id: \.self) { b in NPBadge(text: b.label, color: NCTone.color(b.tone)) }
                NPBadge(text: p.rfm.label, color: NCTone.color(p.rfm.tone))
                ForEach(p.extended, id: \.self) { b in NPBadge(text: b.label, color: NCTone.color(b.tone)) }
            }
            Text(p.rfm.detail).font(.system(size: 10.5)).foregroundColor(NT.ink3).monospacedDigit()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func statsGrid(_ p: NCDPayload) -> some View {
        let c = p.customer
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            tile("来店回数", "\(c.visitCount)回", tone: NT.ink, sub: nil)
            tile("累計利用額", NT.yen(c.totalSpent), tone: NT.purpleDeep, sub: "返金控除後")
            tile("平均客単価", NT.yen(p.avgSpend), tone: NT.ink, sub: nil)
            tile("最終来店から", p.daysSinceLastVisit.map { "\($0)日" } ?? "—", tone: NT.ink, sub: c.lastVisitAt == nil ? nil : NPOCustomerText.day(c.lastVisitAt))
            tile("予約回数", "\(p.reservationCount)回", tone: NT.ink, sub: nil)
            tile("キャンセル", "\(c.cancelCount)回", tone: c.cancelCount > 0 ? NT.warn : NT.ink, sub: "無断 \(c.noShowCount)回")
        }
    }

    private func tile(_ label: String, _ value: String, tone: Color, sub: String?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3).lineLimit(1)
            Text(value).font(.system(size: 19, weight: NT.strong)).foregroundColor(tone).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
            if let sub { Text(sub).font(.system(size: 10.5)).foregroundColor(NT.ink3).monospacedDigit().lineLimit(1) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
    }

    // MARK: 連絡先・会員（見るだけ。編集は PC）

    private func contactCard(_ p: NCDPayload) -> some View {
        let c = p.customer
        return card("連絡先・会員", en: "Contact") {
            kvRow("電話") {
                if let phone = c.phone?.nilIfEmpty, let url = NPHRDetailSheet.telURL(phone) {
                    Link(destination: url) { Text(phone).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.purple).monospacedDigit() }
                } else {
                    Text(c.phone?.nilIfEmpty ?? "—")
                }
            }
            kvRow("メール") {
                if let email = c.email?.nilIfEmpty, let url = URL(string: "mailto:\(email)") {
                    Link(destination: url) { Text(email).font(.system(size: 13.5)).foregroundColor(NT.purple).lineLimit(1) }
                } else {
                    Text("—")
                }
            }
            kvRow("誕生日") { Text(c.birthday.map(NPDate.slash) ?? "—").monospacedDigit() }
            kvRow("会員番号") { Text(c.memberNo?.nilIfEmpty ?? "—") }
            kvRow("会員ランク") { Text(p.memberRankLabel ?? "—") }
            if p.loyaltyEnabled {
                kvRow("ポイント") { Text("\(c.pointBalance) pt").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit() }
            }
        }
    }

    // MARK: 属性（アレルギーなど。編集できる）

    private func attrsCard(_ p: NCDPayload) -> some View {
        let c = p.customer
        let canEdit = p.canWrite && !c.anonymized
        return card("属性", en: "Preferences", editable: canEdit) {
            kvRow("アレルギー", strong: c.allergyNote?.nilIfEmpty != nil) { Text(c.allergyNote?.nilIfEmpty ?? "—").fixedSize(horizontal: false, vertical: true) }
            kvRow("苦手") { Text(c.dislikeNote?.nilIfEmpty ?? "—").fixedSize(horizontal: false, vertical: true) }
            kvRow("好み") { Text(c.preferenceNote?.nilIfEmpty ?? "—").fixedSize(horizontal: false, vertical: true) }
            kvRow("席の希望") { Text(c.seatPreference?.nilIfEmpty ?? "—").fixedSize(horizontal: false, vertical: true) }
            kvRow("記念日") { Text(c.anniversaryNote?.nilIfEmpty ?? "—").fixedSize(horizontal: false, vertical: true) }
            kvRow("接客メモ") { Text(c.serviceNote?.nilIfEmpty ?? "—").fixedSize(horizontal: false, vertical: true) }
        }
    }

    // MARK: 接客メモ（追加）

    private func notesCard(_ p: NCDPayload) -> some View {
        card("接客メモ", en: "Notes") {
            if p.canWrite && !p.customer.anonymized {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("メモを追加", text: Binding(get: { noteText }, set: { noteText = String($0.prefix(2000)) }), axis: .vertical)
                        .lineLimit(1...5)
                        .font(.system(size: 15)).foregroundColor(NT.ink)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                    Button { Task { await addNote() } } label: {
                        Text("追加").font(.system(size: 14, weight: NT.strong)).foregroundColor(.white)
                            .padding(.horizontal, 14).frame(height: 42)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(noteReady ? NT.purple : NT.ink3))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(!noteReady || list.busy)
                }
            }
            if p.notes.isEmpty {
                Text("メモはありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(p.notes) { n in
                VStack(alignment: .leading, spacing: 3) {
                    Text(n.body).font(.system(size: 14)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
                    Text("\(NNoticeTime.fmt(n.createdAt))\(n.creatorName.map { "・\($0)" } ?? "")").font(.system(size: 11)).foregroundColor(NT.ink3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
            }
        }
    }

    private var noteReady: Bool { !noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    // MARK: タグ（付ける・外す）

    private func tagsCard(_ p: NCDPayload) -> some View {
        let attached = Set(p.tags.map(\.id))
        let available = p.allTags.filter { !attached.contains($0.id) }
        return card("タグ", en: "Tags") {
            if p.tags.isEmpty {
                Text("タグはまだありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            } else {
                WrapLayout(spacing: 6) {
                    ForEach(p.tags) { t in
                        HStack(spacing: 5) {
                            Text(t.name).font(.system(size: 13, weight: .bold))
                            if p.canWrite {
                                Button { Task { await act(["type": "customerTagDetach", "id": id, "tagId": t.id], done: "タグを外しました") } } label: {
                                    Image(systemName: "xmark").font(.system(size: 10, weight: NT.strong)).frame(width: 22, height: 22)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("\(t.name)を外す")
                                .disabled(list.busy)
                            }
                        }
                        .foregroundColor(NCTone.hex(t.color))
                        .padding(.leading, 10).padding(.trailing, p.canWrite ? 4 : 10).frame(height: 32)
                        .background(Capsule().fill(NCTone.hex(t.color).opacity(0.12)))
                    }
                }
            }
            if p.canWrite && !available.isEmpty {
                Menu {
                    ForEach(available) { t in
                        Button(t.name) { Task { await act(["type": "customerTagAttach", "id": id, "tagId": t.id], done: "タグを付けました") } }
                    }
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "plus").font(.system(size: 12, weight: NT.strong))
                        Text("タグを付ける").font(.system(size: 13, weight: NT.strong))
                    }
                    .foregroundColor(NT.purple)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.lilac))
                }
                .disabled(list.busy)
            }
        }
    }

    // MARK: 予約履歴・注文履歴（直近 20 件）

    private func reservationsCard(_ p: NCDPayload) -> some View {
        card("予約履歴", en: "直近20件") {
            if p.reservations.isEmpty {
                Text("予約履歴はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(p.reservations) { r in
                Button { onWeb("/app/reservations?open=\(r.id)") } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(NNoticeTime.fmt(r.startAt)).font(.system(size: 13.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
                            Text([r.storeName, "\(r.partySize)名", r.cancelReason].compactMap { $0?.nilIfEmpty }.joined(separator: "・"))
                                .font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        NPBadge(text: r.status.label, color: NCTone.color(r.status.tone))
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1) }
            }
        }
    }

    private func ordersCard(_ p: NCDPayload) -> some View {
        card("注文履歴", en: "直近20件") {
            if p.orders.isEmpty {
                Text("注文履歴はありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(p.orders) { o in
                Button { onWeb("/app/orders/\(o.id)") } label: {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(NNoticeTime.fmt(o.openedAt)).font(.system(size: 13.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1)
                            if let s = o.storeName { Text(s).font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(1) }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        Text(NT.yen(o.total)).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    }
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .bottom) { Rectangle().fill(NT.line.opacity(0.7)).frame(height: 1) }
            }
        }
    }

    private func ltvCard(_ p: NCDPayload) -> some View {
        card("LTV（顧客生涯価値）", en: "LTV") {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("実績（累計・返金控除後）").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    Text(NT.yen(p.ltv.actual)).font(.system(size: 19, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                VStack(alignment: .leading, spacing: 2) {
                    Text("12ヶ月予測（参考）").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                    Text(p.ltv.projected12m.map { NT.yen($0) } ?? "算出中").font(.system(size: 19, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text(p.ltv.projected12m == nil
                 ? "来店実績が2回未満のため予測は出ません。"
                 : "平均客単価 \(NT.yen(p.ltv.avgSpend)) × 月の来店 \(p.ltv.visitsPerMonth.map { String(format: "%g", $0) } ?? "—")回 × 12ヶ月の参考値です。")
                .font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 部品

    /// 白いカード。editable なら右上に「編集」（属性の編集を開く）
    private func card<Content: View>(_ title: String, en: String, editable: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        let inner = content()
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(title).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Text(en).font(.system(size: 11, weight: .medium)).foregroundColor(NT.ink3)
                Spacer()
                if editable {
                    Button { attrsOpen = true } label: {
                        Text("編集").font(.system(size: 13, weight: NT.strong)).foregroundColor(NT.purple)
                            .padding(.horizontal, 12).frame(height: 32)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.lilac))
                    }
                    .buttonStyle(PressableStyle())
                }
            }
            inner
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
    }

    private func kvRow<Content: View>(_ label: String, strong: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        let inner = content()
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3).frame(width: 80, alignment: .leading)
            inner
                .font(.system(size: 14, weight: strong ? NT.strong : .regular))
                .foregroundColor(strong ? NT.danger : NT.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func line(_ a: String, _ b: String, _ c: String) -> some View {
        HStack(spacing: 8) {
            Text(a).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            Text(b).font(.system(size: 12.5)).foregroundColor(NT.ink2).monospacedDigit()
            Text(c).font(.system(size: 13.5, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit().frame(minWidth: 72, alignment: .trailing)
        }
        .padding(.vertical, 3)
    }

    // MARK: 読み込み・操作

    private func load() async {
        // 見本（シミュレーター）は通信しない
        if sample != nil || NativePreview.current != nil { return }
        do {
            payload = try await NativeModuleAPI.get(NCDPayload.self, part: "customer", query: ["id": id])
            loadError = nil
        } catch {
            loadError = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    /// 操作して読み直す。うまくいかなければ上に赤で出す
    @discardableResult
    private func act(_ body: [String: Any], done: String) async -> Bool {
        problem = nil
        if let e = await list.act(body, done: done) {
            problem = e
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return false
        }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        await load()
        return true
    }

    private func addNote() async {
        let body = noteText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        if await act(["type": "customerNote", "id": id, "body": body], done: "メモを追加しました") {
            noteText = ""
        }
    }
}

// MARK: - 属性の編集（Web の AttributesCard と同じ）

struct NPOCustomerAttrsSheet: View {
    let c: NCDCustomer
    @ObservedObject var list: NPOCustomersModel
    let onDone: (Bool) -> Void
    @State private var allergy = ""
    @State private var dislike = ""
    @State private var preference = ""
    @State private var seat = ""
    @State private var anniversary = ""
    @State private var service = ""
    @State private var error: String? = nil
    @State private var loaded = false

    init(c: NCDCustomer, list: NPOCustomersModel, onDone: @escaping (Bool) -> Void) {
        self.c = c
        self.list = list
        self.onDone = onDone
    }

    var body: some View {
        VStack(spacing: 0) {
            sheetHead("属性を編集", onClose: { onDone(false) })
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    area("アレルギー", "小麦・えび 等", $allergy, max: 1000)
                    area("苦手", "", $dislike, max: 1000)
                    area("好み", "辛い物が好き 等", $preference, max: 1000)
                    area("席の希望", "窓側・個室 等", $seat, max: 500)
                    area("記念日", "結婚記念日 6月 等", $anniversary, max: 500)
                    area("接客メモ", "接客上の申し送り事項", $service, max: 2000)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            sheetFoot(error: error, busy: list.busy, ok: "保存する", onCancel: { onDone(false) }) {
                Task {
                    error = nil
                    let body: [String: Any] = ["type": "customerAttributes", "id": c.id, "allergyNote": allergy, "dislikeNote": dislike, "preferenceNote": preference,
                                               "seatPreference": seat, "anniversaryNote": anniversary, "serviceNote": service]
                    if let e = await list.act(body, done: "保存しました") { error = e } else { onDone(true) }
                }
            }
        }
        .background(NT.page.ignoresSafeArea())
        .onAppear {
            guard !loaded else { return }
            loaded = true
            allergy = c.allergyNote ?? ""
            dislike = c.dislikeNote ?? ""
            preference = c.preferenceNote ?? ""
            seat = c.seatPreference ?? ""
            anniversary = c.anniversaryNote ?? ""
            service = c.serviceNote ?? ""
        }
    }
}

// MARK: - 顧客を登録（Web の CreateCustomerDialog と同じ項目のうち、よく使うもの）

struct NPOCustomerCreateSheet: View {
    @ObservedObject var model: NPOCustomersModel
    let onDone: (String?) -> Void
    @State private var name = ""
    @State private var kana = ""
    @State private var phone = ""
    @State private var email = ""
    @State private var allergy = ""
    @State private var memo = ""
    @State private var error: String? = nil
    @State private var saving = false

    init(model: NPOCustomersModel, onDone: @escaping (String?) -> Void) {
        self.model = model
        self.onDone = onDone
    }

    var body: some View {
        VStack(spacing: 0) {
            sheetHead("顧客を登録", onClose: { onDone(nil) })
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    field("名前", required: true, "山田 太郎", $name)
                    field("フリガナ", required: false, "ヤマダ タロウ", $kana)
                    field("電話番号", required: false, "090-1234-5678", $phone).keyboardType(.phonePad)
                    field("メールアドレス", required: false, "taro@example.com", $email).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                    area("アレルギー", "小麦・えび 等", $allergy, max: 1000)
                    area("メモ", "接客上の申し送り事項", $memo, max: 2000)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            sheetFoot(error: error, busy: saving, ok: "登録する", onCancel: { onDone(nil) }) {
                Task { await submit() }
            }
        }
        .background(NT.page.ignoresSafeArea())
    }

    private func field(_ label: String, required: Bool, _ placeholder: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label).font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.ink2)
                if required { Text("*").font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.danger) }
            }
            TextField(placeholder, text: text)
                .font(.system(size: 16)).foregroundColor(NT.ink)
                .autocorrectionDisabled()
                .padding(.horizontal, 14).frame(height: 48)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
        }
    }

    private func submit() async {
        error = nil
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !n.isEmpty else {
            error = "名前を入力してください"
            return
        }
        if model.isSample {
            onDone(nil)
            return
        }
        saving = true
        defer { saving = false }
        let body: [String: Any] = ["type": "customerCreate", "name": n, "nameKana": kana, "phone": phone, "email": email,
                                   "birthday": "", "allergyNote": allergy, "preferenceNote": "", "serviceNote": memo]
        let r = await NSPApi.postJSON(body)
        if r.ok {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            model.toast = "顧客を登録しました"
            await model.refresh()
            // サーバーは新しい顧客の id を orderId で返す（iPad と同じ返事）
            onDone(r.json?["orderId"] as? String)
        } else {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            error = r.error ?? "登録に失敗しました"
        }
    }
}

// MARK: - シートの部品（属性の編集・顧客を登録）

private func sheetHead(_ title: String, onClose: @escaping () -> Void) -> some View {
    HStack {
        Text(title).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink)
        Spacer()
        Button(action: onClose) {
            Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink2)
                .frame(width: 36, height: 36).background(Circle().fill(Color.white))
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("閉じる")
    }
    .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 8)
}

private func sheetFoot(error: String?, busy: Bool, ok: String, onCancel: @escaping () -> Void, onOK: @escaping () -> Void) -> some View {
    VStack(spacing: 8) {
        if let error {
            Text(error).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger).frame(maxWidth: .infinity, alignment: .leading)
        }
        HStack(spacing: 8) {
            Button(action: onCancel) {
                Text("やめる").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink2)
                    .frame(maxWidth: .infinity).frame(height: 50)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NT.line, lineWidth: 1))
            }
            .buttonStyle(PressableStyle())
            Button(action: onOK) {
                HStack(spacing: 6) {
                    if busy { ProgressView().tint(.white) }
                    Text(ok)
                }
                .font(.system(size: 15, weight: NT.strong)).foregroundColor(.white)
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(busy ? NT.ink3 : NT.purple))
            }
            .buttonStyle(PressableStyle())
            .disabled(busy)
            .layoutPriority(1)
        }
    }
    .padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 12)
    .background(Color.white.ignoresSafeArea(edges: .bottom))
    .overlay(alignment: .top) { Rectangle().fill(NT.line).frame(height: 1) }
}

private func area(_ label: String, _ placeholder: String, _ text: Binding<String>, max: Int) -> some View {
    VStack(alignment: .leading, spacing: 5) {
        Text(label).font(.system(size: 12, weight: NT.strong)).foregroundColor(NT.ink2)
        TextField(placeholder, text: Binding(get: { text.wrappedValue }, set: { text.wrappedValue = String($0.prefix(max)) }), axis: .vertical)
            .lineLimit(2...5)
            .font(.system(size: 15)).foregroundColor(NT.ink)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
    }
}

// MARK: - 画面の入口（NativePhoneOwnerScreen の "customers"）

/// iPhone の店長・オーナーの顧客台帳（Web の /app/customers・/app/customers/<id> の代わり）
struct NPOCustomersScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model = NPOCustomersModel()

    init(route: NativeModuleRoute) {
        self.route = route
    }

    var body: some View {
        NPOCustomersView(model: model, onBack: { state.closePhoneOwnerModule() }, onWeb: { path in
            // ネイティブの画面を閉じてから（ネイティブがある道ならそのまま開き直す）
            state.phoneOwnerModule = nil
            state.leaveNativePhone(to: path)
        }, openId: Self.customerId(route))
        // 機能がオフ・権限が無いなど：Web の画面（案内が出る）を見せる
        .onChange(of: model.useWeb) { on in if on { state.phoneOwnerModule = nil } }
    }

    /// /app/customers/<id> の <id>
    static func customerId(_ route: NativeModuleRoute) -> String? {
        let parts = route.url.path.split(separator: "/").map(String.init)
        guard parts.count >= 3, parts[0] == "app", parts[1] == "customers" else { return nil }
        let id = parts[2]
        return id.count == 36 && id.allSatisfy({ $0.isHexDigit || $0 == "-" }) ? id : nil
    }
}
