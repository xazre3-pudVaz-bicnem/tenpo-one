import SwiftUI

// 伝票明細（ネイティブ）。Web の /app/orders（一覧）・/app/orders/[id]（詳細・返金・取消・再会計）・レシート／領収書と同じ（2026-10-24）

struct NSOrderRow: Codable, Identifiable {
    struct Pay: Codable { let cash: Int; let credit: Int; let emoney: Int; let points: Int; let other: Int }
    let id: String
    let orderNo: Int
    let place: String
    let status: String
    let voided: Bool
    let partiallyRefunded: Bool
    let total: Int
    let refundTotal: Int
    let discountTotal: Int
    let guestCount: Int
    let openedAt: String
    let closedAt: String?
    let clerk: String?
    let pay: Pay
    let ryoshushoIssued: Bool
}
struct NSPreset: Codable, Hashable { let label: String; let from: String; let to: String }
struct NSMethod: Codable, Hashable { let key: String; let label: String }
struct NSSales: Codable { let settledSales: Int; let settledCount: Int; let guests: Int; let perGuest: Int; let unsettledCount: Int; let unsettledTotal: Int }
struct NSPayload: Codable {
    let store: NFNamed
    let today: String
    let from: String
    let to: String
    let status: String
    let method: String
    let q: String
    let page: Int
    let totalPages: Int
    let presets: [NSPreset]
    let methods: [NSMethod]
    let sales: NSSales
    let orders: [NSOrderRow]
    let canRefund: Bool
    let canCheckout: Bool
}

struct NSDetail: Codable, Identifiable {
    struct Item: Codable, Identifiable { let id: String; let name: String; let unitPrice: Int; let quantity: Double; let lineTotal: Int; let status: String; let cancelReason: String? }
    struct Payment: Codable, Identifiable { let id: String; let method: String; let label: String; let amount: Int; let tendered: Int?; let change: Int?; let paidAt: String; let status: String }
    struct Refund: Codable, Identifiable { let id: String; let kind: String; let method: String; let label: String; let amount: Int; let reason: String; let at: String; let items: [String] }
    struct Refundable: Codable, Identifiable { var id: String { orderItemId }; let orderItemId: String; let name: String; let remainingQty: Double; let remainingAmount: Int }
    struct Breakdown: Codable, Identifiable { var id: String { method }; let method: String; let label: String; let paid: Int; let refunded: Int }
    struct Derived: Codable { let id: String; let orderNo: Int }
    let id: String
    let orderNo: Int
    let place: String
    let status: String
    let guestCount: Int
    let subtotal: Int
    let taxTotal: Int
    let serviceCharge: Int
    let discountTotal: Int
    let discountReason: String?
    let total: Int
    let openedAt: String
    let closedAt: String?
    let customerName: String?
    let items: [Item]
    let payments: [Payment]
    let refunds: [Refund]
    let totalPaid: Int
    let totalRefunded: Int
    let refundable: Int
    let refundableItems: [Refundable]
    let paymentBreakdown: [Breakdown]
    let hasVoid: Bool
    let canRefund: Bool
    let canReopen: Bool
    let fullyRefunded: Bool
    let openDerived: Derived?
    let ryoshushoIssued: Bool
}

private let NS_STATUS: [(String, String)] = [("", "すべて"), ("open", "未会計"), ("paid", "会計済"), ("refunded", "返金済"), ("cancelled", "取消"), ("void", "無効")]
private func nsStatusLabel(_ s: String) -> (String, Color) {
    switch s {
    case "open": return ("未会計", Color(hex: 0xC27C0E))
    case "paid": return ("会計済", NFColor.success)
    case "refunded": return ("返金済", NFColor.danger)
    case "cancelled": return ("取消", NFColor.ink2)
    case "void": return ("無効", NFColor.ink2)
    default: return (s, NFColor.ink2)
    }
}
private func nsTime(_ iso: String?, withDate: Bool) -> String {
    guard let iso else { return "" }
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
    let o = DateFormatter(); o.timeZone = TimeZone(identifier: "Asia/Tokyo"); o.dateFormat = withDate ? "M/d HH:mm" : "HH:mm"
    return o.string(from: d)
}

@MainActor
final class NativeSlipsModel: ObservableObject {
    @Published var payload: NSPayload?
    @Published var detail: NSDetail?
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?
    var from = ""
    var to = ""
    var status = ""
    var method = ""
    var q = ""
    var page = 1

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            var items = [URLQueryItem(name: "part", value: "slips")]
            for (k, v) in [("from", from), ("to", to), ("status", status), ("method", method), ("q", q), ("page", page > 1 ? String(page) : "")] where !v.isEmpty {
                items.append(URLQueryItem(name: k, value: v))
            }
            comps.queryItems = items
            // 前に開いたときの中身を先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「取込み」）
            if payload == nil, let saved = NativeAPI.cached(NSPayload.self, comps.url) { payload = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            let p = try JSONDecoder().decode(NSPayload.self, from: data)
            payload = p
            from = p.from; to = p.to
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func openDetail(_ id: String) async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "slip"), URLQueryItem(name: "id", value: id)]
            if let saved = NativeAPI.cached(NSDetail.self, comps.url) { detail = saved }
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            detail = try JSONDecoder().decode(NSDetail.self, from: data)
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

struct NativeSlipsView: View {
    @ObservedObject var model: NativeSlipsModel
    let onHome: () -> Void
    let onOpenOrder: (String) -> Void
    /// ほかの画面から「この伝票の明細を開く」（/app/orders/<id>）
    var openId: String? = nil
    var onOpened: () -> Void = {}

    @State private var ryoshushoFor: NSOrderRow?
    @State private var showDetail = false
    @State private var searchText = ""
    @State private var fromDate = Date()
    @State private var toDate = Date()
    @State private var filterOpen = false

    private var p: NSPayload? { model.payload }
    private var multiDay: Bool { (p?.from ?? "") != (p?.to ?? "") }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: p?.store.name ?? "", title: "伝票明細", subtitle: "Slips / Receipts", onHome: onHome)
            if let p {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        periodBar(p)
                        salesTiles(p)
                        statusChips(p)
                        if p.orders.isEmpty {
                            VStack(spacing: 4) {
                                Text("該当する伝票がありません").font(.system(size: 16, weight: .bold))
                                Text("期間や条件を変更してお試しください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 50)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                        } else {
                            VStack(spacing: 0) { ForEach(p.orders) { o in orderRow(o, p) } }
                                .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                        }
                        if p.totalPages > 1 { pager(p) }
                    }
                    .padding(16)
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
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e).multilineTextAlignment(.leading); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger)
                        .padding(14).background(RoundedRectangle(cornerRadius: 14).fill(NFColor.dangerSoft)).frame(maxWidth: 720)
                }.buttonStyle(.plain).padding(.top, 74)
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NFColor.navy.opacity(0.92))).padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .sheet(item: $ryoshushoFor) { o in
            NSRyoshushoSheet(orderId: o.id, orderNo: o.orderNo, amount: o.total - o.refundTotal, onClose: { ryoshushoFor = nil }, send: { body in
                if await model.act(body) != nil {
                    model.toast = "領収書を印刷します"
                    await model.refresh()
                    return nil
                }
                let e = model.error
                model.error = nil
                return e ?? "領収書を印刷できませんでした"
            })
        }
        .sheet(isPresented: $showDetail, onDismiss: { model.detail = nil; Task { await model.refresh() } }) {
            if let d = model.detail {
                NSDetailSheet(model: model, detail: d, onClose: { showDetail = false }, onOpenOrder: { id in showDetail = false; onOpenOrder(id) })
            } else {
                ProgressView().padding(40)
            }
        }
        .task { await model.refresh() }
        .task(id: openId) {
            guard let openId else { return }
            await model.openDetail(openId)
            if model.detail != nil { showDetail = true }
            onOpened()
        }
    }

    // MARK: 期間（今日・昨日・一昨日・今週・今月・過去7日・過去30日・日付）＋支払方法・伝票No

    private func periodBar(_ p: NSPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "calendar").foregroundColor(NFColor.royal)
                Text(periodLabel(p)).font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer()
                Button { Task { await exportCsv(p) } } label: {
                    HStack(spacing: 6) { Image(systemName: "arrow.down.doc"); Text("CSV出力") }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }.buttonStyle(PressableStyle())
                Button { filterOpen.toggle() } label: {
                    HStack(spacing: 6) { Image(systemName: "line.3.horizontal.decrease.circle"); Text("絞り込み") }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(filterOpen ? .white : NFColor.ink)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(filterOpen ? NFColor.iris : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }.buttonStyle(PressableStyle())
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(p.presets, id: \.self) { pr in
                        let on = pr.from == p.from && pr.to == p.to
                        chip(pr.label, on: on) { model.from = pr.from; model.to = pr.to; model.page = 1; Task { await model.refresh() } }
                    }
                }
            }
            if filterOpen {
                HStack(alignment: .bottom, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("開始日").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        DatePicker("", selection: $fromDate, displayedComponents: .date).labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("終了日").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        DatePicker("", selection: $toDate, displayedComponents: .date).labelsHidden()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("支払方法").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        Picker("支払方法", selection: Binding(get: { model.method }, set: { model.method = $0 })) {
                            Text("すべて").tag("")
                            ForEach(p.methods, id: \.self) { m in Text(m.label).tag(m.key) }
                        }.pickerStyle(.menu)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("伝票No（注文番号）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        TextField("#123", text: $searchText).keyboardType(.numberPad).textFieldStyle(.roundedBorder).frame(width: 120)
                    }
                    Button("この条件で表示") {
                        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                        model.from = f.string(from: fromDate); model.to = f.string(from: toDate); model.q = searchText; model.page = 1
                        Task { await model.refresh() }
                    }
                    .buttonStyle(.borderedProminent).tint(NFColor.iris)
                    Button("解除") { model.method = ""; model.q = ""; searchText = ""; model.page = 1; Task { await model.refresh() } }
                }
                .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .onAppear {
                    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                    fromDate = f.date(from: p.from) ?? Date(); toDate = f.date(from: p.to) ?? Date(); searchText = p.q
                }
            }
        }
    }

    private func periodLabel(_ p: NSPayload) -> String {
        if p.from == p.to { return p.from.replacingOccurrences(of: "-", with: "/") }
        return "\(p.from.replacingOccurrences(of: "-", with: "/")) 〜 \(String(p.to.dropFirst(5)).replacingOccurrences(of: "-", with: "/"))"
    }

    private func exportCsv(_ p: NSPayload) async {
        var path = "/app/orders/export?from=\(p.from)&to=\(p.to)"
        if !p.status.isEmpty { path += "&status=\(p.status)" }
        do {
            let data = try await NativeAPI.shared.download(path)
            if let url = NLShare.tempFile("伝票明細_\(p.from)_\(p.to).csv", data: data) { NLShare.present(url: url) }
        } catch { model.error = (error as? NativeAPIError)?.message ?? "CSV を取り出せませんでした" }
    }

    private func salesTiles(_ p: NSPayload) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
            tile("売上（\(multiDay ? "期間" : "当日")・会計済）", NT.yen(p.sales.settledSales), strong: true)
            tile("会計件数", "\(p.sales.settledCount)件")
            tile("客数", "\(p.sales.guests)名")
            tile("客単価", NT.yen(p.sales.perGuest))
            tile("未会計", "\(p.sales.unsettledCount)件 \(NT.yen(p.sales.unsettledTotal))")
        }
    }

    private func tile(_ label: String, _ value: String, strong: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.system(size: 11)).foregroundColor(strong ? .white.opacity(0.8) : NFColor.ink3).lineLimit(1).minimumScaleFactor(0.8)
            Text(value).font(.system(size: 20, weight: .heavy)).monospacedDigit().foregroundColor(strong ? .white : NFColor.ink).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(strong ? NFColor.royal : Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(strong ? Color.clear : NFColor.line, lineWidth: 1))
    }

    private func statusChips(_ p: NSPayload) -> some View {
        HStack(spacing: 6) {
            ForEach(NS_STATUS, id: \.0) { k, l in
                chip(l, on: p.status == k) { model.status = k; model.page = 1; Task { await model.refresh() } }
            }
            Spacer()
            if !p.method.isEmpty || !p.q.isEmpty {
                Text([p.method.isEmpty ? nil : "支払方法: \(p.methods.first { $0.key == p.method }?.label ?? p.method)", p.q.isEmpty ? nil : "伝票No: \(p.q)"].compactMap { $0 }.joined(separator: "　"))
                    .font(.system(size: 12)).foregroundColor(NFColor.ink3)
            }
        }
    }

    private func chip(_ t: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 14, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 14).frame(height: 36)
                .background(Capsule().fill(on ? NFColor.iris : Color.white))
                .overlay(Capsule().stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle())
    }

    private func orderRow(_ o: NSOrderRow, _ p: NSPayload) -> some View {
        let open = o.status == "open"
        let (sl, sc) = nsStatusLabel(o.status)
        return HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) { Image(systemName: "receipt"); Text("#\(o.orderNo)") }.font(.system(size: 16, weight: .heavy)).foregroundColor(NFColor.royal)
                HStack(spacing: 6) { Image(systemName: "fork.knife").font(.system(size: 11)).foregroundColor(NFColor.ink3); Text(o.place).font(.system(size: 14, weight: .bold)) }
                HStack(spacing: 4) {
                    badge(sl, sc)
                    if o.voided { badge("取消", NFColor.ink2) }
                    if o.partiallyRefunded { badge("一部返金あり", Color(hex: 0xC27C0E)) }
                }
            }
            .frame(width: 170, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                kv("現金", o.pay.cash); kv("クレジット", o.pay.credit); kv("電子マネー", o.pay.emoney); kv("ポイント", o.pay.points); kv("その他", o.pay.other)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 8) {
                    Text("金額").frame(width: 72, alignment: .leading).foregroundColor(NFColor.ink3)
                    Text(NT.yen(o.total)).fontWeight(.bold)
                    if o.refundTotal > 0 { Text("純額 \(NT.yen(o.total - o.refundTotal))").font(.system(size: 11)).foregroundColor(NFColor.danger) }
                }
                line("値割引計", NT.yen(o.discountTotal))
                line("人数", "\(o.guestCount)")
                line("入退店時間", "\(nsTime(o.openedAt, withDate: multiDay))〜\(open ? "" : nsTime(o.closedAt, withDate: multiDay))")
                line("会計担当", o.clerk ?? "—")
            }
            .font(.system(size: 13)).monospacedDigit()
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 6) {
                if open {
                    actionBtn("注文・会計", filled: true) { onOpenOrder(o.id) }
                } else {
                    actionBtn("レシート", icon: "printer", filled: false) {
                        Task { if await model.act(["type": "slipReceipt", "orderId": o.id]) != nil { model.toast = "レシートを印刷します" } }
                    }
                    if o.status == "paid" && !o.voided {
                        if o.ryoshushoIssued {
                            Text("領収書 発行済").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3).frame(width: 130, height: 38)
                                .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                        } else {
                            actionBtn("領収書", icon: "doc.text", filled: false) { ryoshushoFor = o }
                        }
                    }
                    actionBtn("詳細", filled: false) {
                        Task { await model.openDetail(o.id); if model.detail != nil { showDetail = true } }
                    }
                }
            }
            .frame(width: 130)
        }
        .padding(16)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func kv(_ label: String, _ v: Int) -> some View {
        HStack(spacing: 8) {
            Text(label).frame(width: 80, alignment: .leading).foregroundColor(NFColor.ink3)
            Text(v > 0 ? NT.yen(v) : "—").foregroundColor(v > 0 ? NFColor.ink : NFColor.ink3)
        }.font(.system(size: 13)).monospacedDigit()
    }
    private func line(_ label: String, _ v: String) -> some View {
        HStack(spacing: 8) { Text(label).frame(width: 72, alignment: .leading).foregroundColor(NFColor.ink3); Text(v) }
    }
    private func badge(_ t: String, _ c: Color) -> some View {
        Text(t).font(.system(size: 11, weight: .bold)).foregroundColor(c).padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(c.opacity(0.12)))
    }
    private func actionBtn(_ t: String, icon: String? = nil, filled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) { if let icon { Image(systemName: icon) }; Text(t) }
                .font(.system(size: 13, weight: .bold)).foregroundColor(filled ? .white : NFColor.royal)
                .frame(width: 130, height: 38)
                .background(RoundedRectangle(cornerRadius: 10).fill(filled ? NFColor.iris : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(filled ? Color.clear : NFColor.wisteria, lineWidth: 1))
        }.buttonStyle(PressableStyle()).disabled(model.busy)
    }

    private func pager(_ p: NSPayload) -> some View {
        HStack {
            Text("\(p.page) / \(p.totalPages) ページ").font(.system(size: 13)).foregroundColor(NFColor.ink2)
            Spacer()
            Button("前へ") { model.page = max(1, p.page - 1); Task { await model.refresh() } }.disabled(p.page <= 1)
            Button("次へ") { model.page = min(p.totalPages, p.page + 1); Task { await model.refresh() } }.disabled(p.page >= p.totalPages)
        }
        .buttonStyle(.bordered)
    }
}

// MARK: - 領収書（宛名・但し書き・分割。一度きり）

/// 領収書（宛名・但し書き・分けて発行）。伝票明細とお会計の完了画面の両方から使う（2026-10-25 00:08 Ronnie「会計の完了画面にも領収書を」）
struct NSRyoshushoSheet: View {
    let orderId: String
    let orderNo: Int
    let amount: Int
    let onClose: () -> Void
    /// 送る（POST slipRyoshusho）。nil＝印刷を受け付けた、文字＝エラー
    let send: @MainActor ([String: Any]) async -> String?

    @State private var busy = false
    @State private var recipient = ""
    @State private var purpose = ""
    @State private var split = false
    @State private var parts: [String] = ["", ""]
    @State private var problem: String?

    private var splitAmounts: [Int] { parts.compactMap { Int($0) }.filter { $0 > 0 } }

    var body: some View {
        NavigationStack {
            Form {
                Section { HStack { Text("伝票 #\(orderNo)"); Spacer(); Text(NT.yen(amount)).font(.system(size: 20, weight: .heavy)).monospacedDigit() } }
                Section(header: Text("宛名 / Recipient"), footer: Text("空欄なら手書き用の下線の空欄になります")) {
                    TextField("株式会社〇〇 様", text: $recipient)
                }
                Section(header: Text("但し書き / Purpose"), footer: Text("空欄なら「飲食代として」")) {
                    TextField("飲食代として", text: $purpose)
                }
                Section(header: Text("分けて発行（任意）"), footer: Text("合計が \(NT.yen(amount)) と同じときだけ発行できます。会計・売上は分けません。")) {
                    Toggle("領収書を分ける", isOn: $split)
                    if split {
                        ForEach(parts.indices, id: \.self) { i in
                            HStack { Text("\(i + 1)枚目"); TextField("金額", text: $parts[i]).keyboardType(.numberPad).multilineTextAlignment(.trailing) }
                        }
                        Button("＋ 1枚ふやす") { parts.append("") }
                        HStack { Text("合計"); Spacer(); Text(NT.yen(splitAmounts.reduce(0, +))).foregroundColor(splitAmounts.reduce(0, +) == amount ? NFColor.success : NFColor.danger) }
                    }
                }
                if let problem { Section { Text(problem).foregroundColor(NFColor.danger) } }
                Section(footer: Text("領収書は一度しか発行できません。")) {
                    Button { Task { await issue() } } label: {
                        Text(busy ? "印刷中…" : "領収書を印刷する").font(.system(size: 17, weight: .heavy)).frame(maxWidth: .infinity)
                    }.disabled(busy)
                }
            }
            .navigationTitle("領収書 / Receipt for expenses")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }

    private func issue() async {
        var body: [String: Any] = ["type": "slipRyoshusho", "orderId": orderId, "recipientName": recipient, "purpose": purpose]
        if split {
            guard splitAmounts.count >= 2, splitAmounts.reduce(0, +) == amount else { problem = "分ける金額の合計を \(NT.yen(amount)) にしてください"; return }
            body["splitAmounts"] = splitAmounts
        }
        busy = true
        let err = await send(body)
        busy = false
        if let err { problem = err } else { onClose() }
    }
}

// MARK: - 詳細（品目・支払・返金履歴・会計情報・返金／取消・再会計）

struct NSDetailSheet: View {
    @ObservedObject var model: NativeSlipsModel
    let detail: NSDetail
    let onClose: () -> Void
    let onOpenOrder: (String) -> Void

    @State private var refundOpen = false
    @State private var reopenOpen = false
    @State private var reopenReason = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Text(detail.place).font(.system(size: 15, weight: .bold))
                        Text(nsTime(detail.openedAt, withDate: true)).foregroundColor(NFColor.ink3)
                        Spacer()
                        let (l, c) = nsStatusLabel(detail.status)
                        Text(l).font(.system(size: 13, weight: .bold)).foregroundColor(c)
                        if detail.hasVoid { Text("取消（VOID）あり").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink2) }
                    }
                    HStack(spacing: 10) {
                        if detail.status == "open" {
                            Button("注文・会計") { onOpenOrder(detail.id) }.buttonStyle(.borderedProminent)
                        } else {
                            Button { Task { if await model.act(["type": "slipReceipt", "orderId": detail.id]) != nil { model.toast = "レシートを印刷します" } } } label: { Label("レシートを印刷", systemImage: "printer") }.buttonStyle(.bordered)
                        }
                    }
                }
                Section("品目明細 / Items") {
                    ForEach(detail.items) { it in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(it.name).strikethrough(it.status != "active")
                                if it.status != "active" { Text("取消\(it.cancelReason.map { "：\($0)" } ?? "")").font(.system(size: 11)).foregroundColor(NFColor.danger) }
                            }
                            Spacer()
                            Text("\(NT.yen(it.unitPrice)) × \(it.quantity == it.quantity.rounded() ? String(Int(it.quantity)) : String(it.quantity))").foregroundColor(NFColor.ink3).font(.system(size: 13))
                            Text(NT.yen(it.lineTotal)).frame(width: 90, alignment: .trailing).monospacedDigit()
                        }
                    }
                }
                Section("会計情報 / Summary") {
                    sum("小計", detail.subtotal)
                    if detail.serviceCharge > 0 { sum("サービス料", detail.serviceCharge) }
                    if detail.discountTotal > 0 { sum("値引\(detail.discountReason.map { "（\($0)）" } ?? "")", -detail.discountTotal) }
                    sum("うち消費税", detail.taxTotal)
                    sum("合計", detail.total, bold: true)
                    sum("人数", nil, text: "\(detail.guestCount)名")
                    if let c = detail.customerName { sum("顧客", nil, text: c) }
                }
                Section("支払 / Payments") {
                    if detail.payments.isEmpty { Text("支払記録がありません").foregroundColor(NFColor.ink3) }
                    ForEach(detail.payments) { pmt in
                        HStack {
                            Text(pmt.label)
                            if pmt.status != "completed" { Text("（\(pmt.status)）").foregroundColor(NFColor.ink3) }
                            Spacer()
                            if let t = pmt.tendered { Text("預り \(NT.yen(t))").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                            if let c = pmt.change, c > 0 { Text("釣 \(NT.yen(c))").font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                            Text(NT.yen(pmt.amount)).monospacedDigit().frame(width: 90, alignment: .trailing)
                            Text(nsTime(pmt.paidAt, withDate: true)).font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                    }
                }
                if !detail.refunds.isEmpty {
                    Section("返金履歴 / Refunds") {
                        ForEach(detail.refunds) { r in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(r.kind == "void" ? "取消（VOID）" : "返金").fontWeight(.bold)
                                    Text(r.label).foregroundColor(NFColor.ink2)
                                    Spacer()
                                    Text("−\(NT.yen(r.amount))").foregroundColor(NFColor.danger).monospacedDigit()
                                }
                                Text("理由: \(r.reason)　\(nsTime(r.at, withDate: true))").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                if !r.items.isEmpty { Text(r.items.joined(separator: "、")).font(.system(size: 12)).foregroundColor(NFColor.ink3) }
                            }
                        }
                    }
                }
                if detail.canRefund || (detail.refundable <= 0 && ["paid", "refunded"].contains(detail.status) && detail.canReopen) {
                    Section("返金・取消 / Refund") {
                        if detail.canRefund {
                            Button(role: .destructive) { refundOpen = true } label: { Text("返金・取消する").fontWeight(.bold).frame(maxWidth: .infinity) }
                        } else {
                            Text("これ以上返金できる金額はありません").foregroundColor(NFColor.ink3)
                        }
                    }
                }
                if detail.canReopen {
                    Section("再会計 / Reopen") {
                        if let d = detail.openDerived {
                            Text("再会計伝票 #\(d.orderNo) が作成済みです。").foregroundColor(NFColor.ink3)
                            Button("POSで開く") { onOpenOrder(d.id) }
                        } else if detail.fullyRefunded {
                            Button("再会計する") { reopenOpen = true }
                        } else {
                            Text("再会計するには先に全額返金してください\(detail.refundable > 0 ? "（未返金 \(NT.yen(detail.refundable))）" : "")").foregroundColor(NFColor.ink3)
                        }
                    }
                }
            }
            .navigationTitle("伝票 #\(detail.orderNo)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
            .sheet(isPresented: $refundOpen) {
                NSRefundSheet(model: model, detail: detail) { done in
                    refundOpen = false
                    if done { Task { await model.openDetail(detail.id) } }
                }
            }
            .alert("再会計", isPresented: $reopenOpen) {
                TextField("再会計理由", text: $reopenReason)
                Button("再会計する") {
                    Task {
                        if let r = await model.act(["type": "slipReopen", "orderId": detail.id, "reason": reopenReason]), let id = r.orderId {
                            onOpenOrder(id)
                        }
                    }
                }
                Button("キャンセル", role: .cancel) {}
            } message: {
                Text("全額返金済みの伝票の品目をコピーした新しい伝票を作って開きます。元の伝票は返金済みのまま残ります。")
            }
        }
    }

    private func sum(_ label: String, _ v: Int?, bold: Bool = false, text: String? = nil) -> some View {
        HStack {
            Text(label).fontWeight(bold ? .bold : .regular)
            Spacer()
            Text(text ?? (v.map { $0 < 0 ? "−\(NT.yen(-$0))" : NT.yen($0) } ?? "")).fontWeight(bold ? .heavy : .regular).monospacedDigit()
        }
    }
}

// MARK: - 返金・取消（Web の RefundDialog と同じ）

struct NSRefundSheet: View {
    @ObservedObject var model: NativeSlipsModel
    let detail: NSDetail
    let onDone: (Bool) -> Void

    @State private var kind = "refund"
    @State private var mode = "amount"
    @State private var amountText = ""
    @State private var method = "cash"
    @State private var reason = ""
    @State private var picked: [String: (qty: Double, restock: Bool)] = [:]
    @State private var problem: String?

    private let methods: [(String, String)] = [("cash", "現金"), ("credit", "クレジット"), ("qr", "QRコード決済（PayPay等）"), ("emoney", "電子マネー"), ("voucher", "商品券"), ("on_account", "掛売"), ("other", "その他")]

    private func amountFor(_ it: NSDetail.Refundable, _ qty: Double) -> Int {
        if qty >= it.remainingQty { return it.remainingAmount }
        return Int((Double(it.remainingAmount) / it.remainingQty * qty).rounded())
    }
    private var itemsPayload: [[String: Any]] {
        detail.refundableItems.compactMap { it in
            guard let s = picked[it.orderItemId], s.qty > 0 else { return nil }
            return ["orderItemId": it.orderItemId, "quantity": s.qty, "amount": amountFor(it, s.qty), "restock": s.restock]
        }
    }
    private var effectiveAmount: Int {
        if kind == "void" { return detail.refundable }
        if mode == "items" { return itemsPayload.reduce(0) { $0 + (($1["amount"] as? Int) ?? 0) } }
        return Int(amountText) ?? 0
    }
    private var canSubmit: Bool {
        !model.busy && !reason.trimmingCharacters(in: .whitespaces).isEmpty && effectiveAmount > 0 && effectiveAmount <= detail.refundable
            && (mode == "amount" || kind == "void" || !itemsPayload.isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section { HStack { Text("返金可能額"); Spacer(); Text(NT.yen(detail.refundable)).fontWeight(.heavy).monospacedDigit() } }
                if !detail.paymentBreakdown.isEmpty {
                    Section(header: Text("この取引の支払内訳"), footer: Text("混合支払の場合、返金する金額がどの支払方法から発生したものかをここで確認してください。")) {
                        ForEach(detail.paymentBreakdown) { b in
                            HStack {
                                Text(b.label); Spacer()
                                Text("支払 \(NT.yen(b.paid))").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                Text(b.refunded > 0 ? "返金 −\(NT.yen(b.refunded))" : "返金 ¥0").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                Text("残 \(NT.yen(b.paid - b.refunded))").fontWeight(.bold).monospacedDigit()
                            }
                        }
                    }
                }
                Section(header: Text("区分"), footer: Text(kind == "void" ? "会計の取消。全額のみ返金できます（金額は固定）。" : "")) {
                    Picker("区分", selection: $kind) { Text("返金").tag("refund"); Text("取消（VOID）").tag("void") }.pickerStyle(.segmented)
                }
                if kind == "refund" {
                    Section("返金方法の選択") {
                        Picker("", selection: $mode) { Text("金額指定").tag("amount"); Text("商品単位").tag("items") }.pickerStyle(.segmented)
                    }
                }
                if kind == "void" || mode == "amount" {
                    Section("返金額") {
                        if kind == "void" { Text(NT.yen(detail.refundable)).fontWeight(.heavy) }
                        else { TextField("\(detail.refundable)", text: $amountText).keyboardType(.numberPad) }
                    }
                } else {
                    Section("返金する品目・数量") {
                        if detail.refundableItems.isEmpty { Text("返金可能な品目がありません").foregroundColor(NFColor.ink3) }
                        ForEach(detail.refundableItems) { it in
                            let sel = picked[it.orderItemId]
                            VStack(alignment: .leading, spacing: 6) {
                                Toggle(isOn: Binding(get: { sel != nil }, set: { on in picked[it.orderItemId] = on ? (it.remainingQty, false) : nil })) {
                                    VStack(alignment: .leading) {
                                        Text(it.name).fontWeight(.medium)
                                        Text("未返金 \(it.remainingQty == it.remainingQty.rounded() ? String(Int(it.remainingQty)) : String(it.remainingQty))点 / \(NT.yen(it.remainingAmount))").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                                    }
                                }
                                if let s = sel {
                                    HStack {
                                        Stepper("数量 \(s.qty == s.qty.rounded() ? String(Int(s.qty)) : String(s.qty))", value: Binding(get: { s.qty }, set: { picked[it.orderItemId] = (min(it.remainingQty, max(1, $0)), s.restock) }), in: 1...max(1, it.remainingQty))
                                        Spacer()
                                        Text(NT.yen(amountFor(it, s.qty))).monospacedDigit()
                                    }
                                    Toggle("在庫を戻す", isOn: Binding(get: { s.restock }, set: { picked[it.orderItemId] = (s.qty, $0) })).font(.system(size: 13))
                                }
                            }
                        }
                        HStack { Text("返金額"); Spacer(); Text(NT.yen(effectiveAmount)).fontWeight(.heavy) }
                    }
                }
                Section("返金先（支払方法）") {
                    Picker("方法", selection: $method) { ForEach(methods, id: \.0) { Text($0.1).tag($0.0) } }
                    if let b = detail.paymentBreakdown.first(where: { $0.method == method }), effectiveAmount > b.paid - b.refunded {
                        Text("選んだ支払方法の残額（\(NT.yen(b.paid - b.refunded))）を超えています。支払方法を確かめてください。").font(.system(size: 12)).foregroundColor(Color(hex: 0xC27C0E))
                    } else if !detail.paymentBreakdown.contains(where: { $0.method == method }) && effectiveAmount > 0 {
                        Text("この取引ではこの支払方法での支払がありません。").font(.system(size: 12)).foregroundColor(Color(hex: 0xC27C0E))
                    }
                }
                Section("理由（必須）") { TextField("例：料理の提供ミス", text: $reason) }
                if let problem { Section { Text(problem).foregroundColor(NFColor.danger) } }
                Section {
                    Button(role: .destructive) { Task { await submit() } } label: {
                        Text(model.busy ? "処理中…" : (kind == "void" ? "取消（VOID）を実行" : "\(NT.yen(effectiveAmount)) を返金する")).fontWeight(.heavy).frame(maxWidth: .infinity)
                    }.disabled(!canSubmit)
                }
            }
            .navigationTitle("返金・取消")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル") { onDone(false) } } }
            .onAppear { amountText = String(detail.refundable) }
        }
    }

    private func submit() async {
        var body: [String: Any] = ["type": "slipRefund", "orderId": detail.id, "amount": effectiveAmount, "method": method, "reason": reason, "kind": kind]
        if kind == "refund" && mode == "items" { body["items"] = itemsPayload }
        if await model.act(body) != nil {
            model.toast = kind == "void" ? "取消を記録しました" : "返金を記録しました"
            onDone(true)
        } else {
            problem = model.error; model.error = nil
        }
    }
}
