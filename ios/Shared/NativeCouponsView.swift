import SwiftUI

// クーポン管理（ネイティブ）。Web の /app/coupons と同じ（2026-10-24）
//   一覧（削除済みを含めて表示）・利用履歴・作成・編集・停止・再開・削除

struct NCPCoupon: Codable, Identifiable, Hashable {
    let id: String
    let code: String
    let name: String
    let kind: String
    let value: Double
    let storeId: String?
    let storeName: String?
    let targetCategoryId: String?
    let targetMenuItemId: String?
    let targetLabel: String
    let minTotal: Double
    let startsAt: String?
    let endsAt: String?
    let timeFrom: String?
    let timeTo: String?
    let maxUses: Int?
    let perCustomerLimit: Int?
    let firstVisitOnly: Bool
    let stackable: Bool
    let status: String
    let redemptionCount: Int
}
struct NCPPayload: Codable { let rows: [NCPCoupon]; let stores: [NFNamed]; let categories: [NFNamed]; let items: [NFNamed] }
struct NCPUse: Codable, Identifiable, Hashable { let id: String; let createdAt: String; let orderId: String; let customerName: String?; let discountAmount: Double }
struct NCPUses: Codable { let rows: [NCPUse] }

struct NativeCouponsView: View {
    @ObservedObject var model: NativePurchasingModel
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var payload: NCPPayload?
    @State private var showDeleted = false
    @State private var editing: NCPFormTarget?
    @State private var deleting: NCPCoupon?
    @State private var open = Set<String>()
    @State private var uses: [String: [NCPUse]] = [:]

    private let statusMap: [String: (String, Color)] = ["active": ("有効", NFColor.success), "paused": ("停止中", NFColor.saffron), "deleted": ("削除済み", NFColor.ink3)]

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "クーポン管理", subtitle: "Coupons", onHome: onHome)
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Text("コード・割引内容・利用条件を管理します（POSでの適用は別画面）").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                    Spacer()
                    Button { onWeb("/app/customers") } label: { Text("顧客一覧へ戻る").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink3) }.buttonStyle(.plain)
                }
                HStack {
                    Button { showDeleted.toggle() } label: {
                        HStack(spacing: 6) {
                            Image(systemName: showDeleted ? "checkmark.square.fill" : "square").font(.system(size: 18)).foregroundColor(showDeleted ? NFColor.iris : NFColor.ink3)
                            Text("削除済みを含めて表示").font(.system(size: 14)).foregroundColor(NFColor.ink2)
                        }
                    }.buttonStyle(.plain)
                    Spacer()
                    Button { editing = NCPFormTarget(coupon: nil) } label: {
                        HStack(spacing: 6) { Image(systemName: "plus"); Text("クーポンを作成") }
                            .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 18).frame(height: 46)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.iris))
                    }.buttonStyle(PressableStyle())
                }
                ScrollView {
                    if let p = payload {
                        let rows = showDeleted ? p.rows : p.rows.filter { $0.status != "deleted" }
                        if rows.isEmpty { niEmpty("クーポンが登録されていません", "「クーポンを作成」から登録してください") } else { table(rows) }
                    } else { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60) }
                }
            }
            .padding(16)
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: true))
        .task { await refresh() }
        .overlay {
            if let e = editing, let p = payload {
                NativeModalCard(width: 820) { NCPForm(model: model, coupon: e.coupon, payload: p, onClose: { editing = nil }, onSaved: { Task { await refresh() } }) }
            } else if let d = deleting {
                NativeModalCard(width: 560) {
                    VStack(alignment: .leading, spacing: 14) {
                        NIDialogHead(title: "クーポンを削除", onClose: { deleting = nil })
                        Text("「\(d.name)」（\(d.code)）を削除します。過去の利用履歴は保持されます。").font(.system(size: 15)).foregroundColor(NFColor.ink2)
                        NIDialogFoot(error: nil, busy: model.busy, okText: "削除する", busyText: "削除中…", danger: true, onCancel: { deleting = nil }) {
                            Task { await setStatus(d, "deleted"); deleting = nil }
                        }
                    }.padding(22)
                }
            }
        }
    }

    private func refresh() async {
        if payload == nil, let saved: NCPPayload = model.peek([URLQueryItem(name: "part", value: "coupons")]) { payload = saved }
        if let p: NCPPayload = await model.get([URLQueryItem(name: "part", value: "coupons")]) { payload = p }
    }

    private func setStatus(_ c: NCPCoupon, _ status: String) async {
        let r = await model.act(["type": "couponStatus", "id": c.id, "status": status])
        if r.ok {
            model.toast = status == "paused" ? "クーポンを停止しました" : status == "active" ? "クーポンを再開しました" : "クーポンを削除しました"
            await refresh()
        } else { model.error = r.error ?? "うまくいきませんでした" }
    }

    private func table(_ rows: [NCPCoupon]) -> some View {
        niCard {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text("コード").frame(width: 120, alignment: .leading)
                    Text("名称").frame(maxWidth: .infinity, alignment: .leading)
                    Text("種別・値").frame(width: 100, alignment: .leading)
                    Text("期間").frame(width: 190, alignment: .leading)
                    Text("利用状況").frame(width: 160, alignment: .leading)
                    Text("状態").frame(width: 80, alignment: .leading)
                    Text("操作").frame(width: 150, alignment: .trailing)
                }
                .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3).padding(.horizontal, 14).frame(height: 38).background(NFColor.lilacSoft)
                ForEach(rows) { r in
                    row(r)
                    if open.contains(r.id) { usesView(r) }
                    Rectangle().fill(NFColor.line).frame(height: 1)
                }
            }
        }
    }

    private func row(_ r: NCPCoupon) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Text(r.code).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundColor(NFColor.navy).frame(width: 120, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NFColor.navy)
                Text("\(r.storeName ?? "全店")｜\(r.targetLabel)\(r.firstVisitOnly ? "｜新規限定" : "")").font(.system(size: 11.5)).foregroundColor(NFColor.ink3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(r.kind == "percent" ? "\(NI.q(r.value))%OFF" : "\(NI.yen(r.value))引き").monospacedDigit().frame(width: 100, alignment: .leading)
            Text("\(r.startsAt.map { NI.date(Self.jstDate($0)) } ?? "—") 〜 \(r.endsAt.map { NI.date(Self.jstDate($0)) } ?? "無期限")").font(.system(size: 12)).foregroundColor(NFColor.ink2).frame(width: 190, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                if r.redemptionCount == 0 {
                    Text("利用0件").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                } else {
                    Button { Task { await toggle(r) } } label: {
                        HStack(spacing: 3) { Text("利用\(r.redemptionCount)件"); Image(systemName: open.contains(r.id) ? "chevron.up" : "chevron.down").font(.system(size: 10, weight: .bold)) }
                            .font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.iris)
                    }.buttonStyle(.plain)
                }
                if let m = r.maxUses {
                    Text("上限\(m)件\(r.perCustomerLimit.map { "（1人\($0)件まで）" } ?? "")").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
            }
            .frame(width: 160, alignment: .leading)
            NPBadge(text: statusMap[r.status]?.0 ?? r.status, color: statusMap[r.status]?.1 ?? NFColor.ink3).frame(width: 80, alignment: .leading)
            HStack(spacing: 6) {
                if r.status != "deleted" { iconBtn("pencil", NFColor.ink2) { editing = NCPFormTarget(coupon: r) } }
                if r.status == "active" { iconBtn("pause.fill", NFColor.saffron) { Task { await setStatus(r, "paused") } } }
                if r.status == "paused" { iconBtn("play.fill", NFColor.success) { Task { await setStatus(r, "active") } } }
                if r.status != "deleted" { iconBtn("trash", NFColor.danger) { deleting = r } }
            }
            .frame(width: 150, alignment: .trailing)
        }
        .font(.system(size: 13.5)).foregroundColor(NFColor.ink)
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func iconBtn(_ icon: String, _ tone: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundColor(tone)
                .frame(width: 38, height: 38).background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }.buttonStyle(PressableStyle()).disabled(model.busy)
    }

    private func toggle(_ r: NCPCoupon) async {
        if open.contains(r.id) { open.remove(r.id); return }
        open.insert(r.id)
        if uses[r.id] == nil, let u: NCPUses = await model.get([URLQueryItem(name: "part", value: "couponUses"), URLQueryItem(name: "id", value: r.id)]) { uses[r.id] = u.rows }
    }

    @ViewBuilder private func usesView(_ r: NCPCoupon) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let list = uses[r.id] {
                if list.isEmpty {
                    Text("利用履歴はありません").font(.system(size: 12)).foregroundColor(NFColor.ink3).padding(.vertical, 8)
                } else {
                    HStack { Text("日時").frame(width: 150, alignment: .leading); Text("顧客").frame(width: 160, alignment: .leading); Text("注文").frame(width: 60, alignment: .leading); Text("値引額").frame(width: 100, alignment: .trailing) }
                        .font(.system(size: 11.5, weight: .bold)).foregroundColor(NFColor.ink3).frame(height: 28)
                    ForEach(list) { u in
                        HStack {
                            Text(NI.dateTime(u.createdAt)).frame(width: 150, alignment: .leading)
                            Text(u.customerName ?? "—").lineLimit(1).frame(width: 160, alignment: .leading)
                            Button { onWeb("/app/orders/\(u.orderId)") } label: { Text("明細").foregroundColor(NFColor.iris) }.buttonStyle(.plain).frame(width: 60, alignment: .leading)
                            Text(NI.yen(u.discountAmount)).monospacedDigit().frame(width: 100, alignment: .trailing)
                        }
                        .font(.system(size: 12.5)).frame(height: 32)
                    }
                }
            } else { ProgressView().padding(.vertical, 8) }
        }
        .padding(.horizontal, 148).padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NFColor.lilacSoft)
    }

    /// ISO → 日本時間の 2026-10-24
    static func jstDate(_ iso: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return String(iso.prefix(10)) }
        return NPDate.str(d)
    }
}

struct NCPFormTarget: Identifiable { let id = UUID(); let coupon: NCPCoupon? }

/// クーポン作成・編集（Web の CouponDialog と同じ全項目）
struct NCPForm: View {
    @ObservedObject var model: NativePurchasingModel
    let coupon: NCPCoupon?
    let payload: NCPPayload
    let onClose: () -> Void
    let onSaved: () -> Void

    @State private var code = ""
    @State private var name = ""
    @State private var kind = "fixed"
    @State private var value = ""
    @State private var minTotal = "0"
    @State private var storeId = ""
    @State private var targetMode = "none"
    @State private var categoryId = ""
    @State private var itemId = ""
    @State private var startsAt: Date?
    @State private var endsAt: Date?
    @State private var timeFrom = ""
    @State private var timeTo = ""
    @State private var maxUses = ""
    @State private var perCustomer = ""
    @State private var firstVisitOnly = false
    @State private var stackable = false
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NIDialogHead(title: coupon == nil ? "クーポン作成" : "クーポン編集", onClose: onClose)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .bottom, spacing: 12) {
                        HStack(alignment: .bottom, spacing: 8) {
                            NIField(label: "コード", text: Binding(get: { code }, set: { code = $0.uppercased() }), placeholder: "SUMMER10")
                            niSmallButton("自動生成") { Task { await generate() } }.frame(height: 46).disabled(model.busy)
                        }
                        NIField(label: "名称", text: $name, placeholder: "サマーセール10%OFF")
                    }
                    HStack(alignment: .bottom, spacing: 12) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("種別").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                            NIChoice(options: [("fixed", "固定額（円）"), ("percent", "割引率（%）")], value: $kind).fixedSize()
                        }
                        NIField(label: kind == "percent" ? "割引率（%）" : "値引き額（円）", text: $value, number: true)
                        NIField(label: "最低利用額（円）", text: $minTotal, number: true)
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        Text("対象店舗").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                        NIChoice(options: [("", "全店")] + payload.stores.map { ($0.id, $0.name) }, value: $storeId)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("対象").font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
                        NIChoice(options: [("none", "全体"), ("category", "カテゴリ指定"), ("item", "商品指定")], value: $targetMode)
                        if targetMode == "category" { picker(payload.categories, $categoryId) }
                        if targetMode == "item" { picker(payload.items, $itemId) }
                    }
                    HStack(alignment: .top, spacing: 12) {
                        dateTimeField("開始日時", $startsAt)
                        dateTimeField("終了日時", $endsAt)
                    }
                    HStack(alignment: .top, spacing: 12) {
                        timeField("利用可能時間帯（開始）", $timeFrom)
                        timeField("利用可能時間帯（終了）", $timeTo)
                    }
                    HStack(spacing: 12) {
                        NIField(label: "利用上限回数（全体・空欄で無制限）", text: $maxUses, number: true)
                        NIField(label: "顧客毎の利用上限（空欄で無制限）", text: $perCustomer, number: true)
                    }
                    HStack(spacing: 20) {
                        check("新規顧客限定", $firstVisitOnly)
                        check("他の値引きと併用可", $stackable)
                    }
                }
            }
            .frame(maxHeight: 620)
            NIDialogFoot(error: error, busy: model.busy, okText: "保存する", busyText: "保存中…", onCancel: onClose) { Task { await save() } }
        }
        .padding(22)
        .onAppear { load() }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        guard let c = coupon else { return }
        code = c.code; name = c.name; kind = c.kind; value = NI.q(c.value); minTotal = NI.q(c.minTotal)
        storeId = c.storeId ?? ""
        targetMode = c.targetCategoryId != nil ? "category" : (c.targetMenuItemId != nil ? "item" : "none")
        categoryId = c.targetCategoryId ?? ""; itemId = c.targetMenuItemId ?? ""
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func iso(_ s: String?) -> Date? { s.flatMap { f.date(from: $0) ?? ISO8601DateFormatter().date(from: $0) } }
        startsAt = iso(c.startsAt); endsAt = iso(c.endsAt)
        timeFrom = c.timeFrom.map { String($0.prefix(5)) } ?? ""; timeTo = c.timeTo.map { String($0.prefix(5)) } ?? ""
        maxUses = c.maxUses.map(String.init) ?? ""; perCustomer = c.perCustomerLimit.map(String.init) ?? ""
        firstVisitOnly = c.firstVisitOnly; stackable = c.stackable
    }

    private func picker(_ options: [NFNamed], _ value: Binding<String>) -> some View {
        Menu {
            Button("選択してください") { value.wrappedValue = "" }
            ForEach(options) { o in Button(o.name) { value.wrappedValue = o.id } }
        } label: {
            HStack { Text(options.first { $0.id == value.wrappedValue }?.name ?? "選択してください").foregroundColor(value.wrappedValue.isEmpty ? NFColor.ink3 : NFColor.ink); Spacer(); Image(systemName: "chevron.down").foregroundColor(NFColor.ink3) }
                .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 12).frame(maxWidth: 420).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        }
    }

    private func dateTimeField(_ label: String, _ value: Binding<Date?>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
            HStack(spacing: 8) {
                if let d = value.wrappedValue {
                    DatePicker("", selection: Binding(get: { d }, set: { value.wrappedValue = $0 }), displayedComponents: [.date, .hourAndMinute])
                        .labelsHidden().environment(\.locale, Locale(identifier: "ja_JP")).environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                    Button { value.wrappedValue = nil } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundColor(NFColor.ink3) }.buttonStyle(.plain)
                } else {
                    niSmallButton("設定する", icon: "calendar") { value.wrappedValue = Date() }.frame(height: 44)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func timeField(_ label: String, _ value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink2)
            HStack(spacing: 8) {
                if !value.wrappedValue.isEmpty {
                    DatePicker("", selection: Binding(get: { Self.hmDate(value.wrappedValue) }, set: { value.wrappedValue = Self.hm($0) }), displayedComponents: .hourAndMinute)
                        .labelsHidden().environment(\.locale, Locale(identifier: "ja_JP"))
                    Button { value.wrappedValue = "" } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundColor(NFColor.ink3) }.buttonStyle(.plain)
                } else {
                    niSmallButton("設定する", icon: "clock") { value.wrappedValue = "17:00" }.frame(height: 44)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func check(_ label: String, _ on: Binding<Bool>) -> some View {
        Button { on.wrappedValue.toggle() } label: {
            HStack(spacing: 6) {
                Image(systemName: on.wrappedValue ? "checkmark.square.fill" : "square").font(.system(size: 20)).foregroundColor(on.wrappedValue ? NFColor.iris : NFColor.ink3)
                Text(label).font(.system(size: 14)).foregroundColor(NFColor.ink)
            }
        }.buttonStyle(.plain)
    }

    static func hmDate(_ s: String) -> Date {
        let p = s.split(separator: ":").compactMap { Int($0) }
        var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone.current
        return c.date(bySettingHour: p.first ?? 0, minute: p.count > 1 ? p[1] : 0, second: 0, of: Date()) ?? Date()
    }
    static func hm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private func generate() async {
        let r = await model.act(["type": "couponCode"])
        if r.ok, let c = r.id { code = c } else { error = r.error ?? "コードを作れませんでした" }
    }

    private func save() async {
        error = nil
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func intOrNull(_ s: String) -> Any { s.trimmingCharacters(in: .whitespaces).isEmpty ? NSNull() : (NI.num(s).map { Int($0) as Any } ?? NSNull()) }
        var body: [String: Any] = [
            "type": "couponSave", "code": code, "name": name, "kind": kind, "value": NI.num(value) ?? 0,
            "storeId": storeId.isEmpty ? NSNull() : storeId,
            "targetCategoryId": targetMode == "category" && !categoryId.isEmpty ? categoryId : NSNull(),
            "targetMenuItemId": targetMode == "item" && !itemId.isEmpty ? itemId : NSNull(),
            "minTotal": NI.num(minTotal) ?? 0,
            "startsAt": startsAt.map { f.string(from: $0) as Any } ?? NSNull(),
            "endsAt": endsAt.map { f.string(from: $0) as Any } ?? NSNull(),
            "timeFrom": timeFrom.isEmpty ? NSNull() : timeFrom, "timeTo": timeTo.isEmpty ? NSNull() : timeTo,
            "maxUses": intOrNull(maxUses), "perCustomerLimit": intOrNull(perCustomer),
            "firstVisitOnly": firstVisitOnly, "stackable": stackable,
        ]
        if let c = coupon { body["id"] = c.id }
        let r = await model.act(body)
        if r.ok {
            model.toast = coupon == nil ? "クーポンを作成しました" : "クーポンを更新しました"
            onClose(); onSaved()
        } else { error = r.error ?? "保存に失敗しました" }
    }
}
