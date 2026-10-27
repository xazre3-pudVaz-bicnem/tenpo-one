import SwiftUI

/// お客様情報・テーブルの準備の色＝うちの色（上のバーと同じネイビー＋オーダー・会計の青＋うすい灰の枠）。
/// 2026-10-25 00:12 Ronnie「これもうちの色に合わせて。デザインはこのままで色だけ」
enum GIColor {
    /// 上のバーのネイビーではなく、ホームの左のバーと同じ紫紺（2026-10-27 03:31 Ronnie「empty table ma click garera … color milau」）
    static let navy = Color(hex: 0x37324D)
    /// 青をやめて紫紺（ホームと同じ。2026-10-27 03:14 Ronnie「rezi ko everywhere color milau」）。名前は昔のまま
    static let blue = Color(hex: 0x37324D)
    static let line = Color(hex: 0xE3E5EA)
    /// うすいネイビー（選んだ顧客の行・＋−のボタンの地）
    static let navySoft = Color(hex: 0xEFF0F4)
}

// お客様情報（ネイティブ）。2026-10-24 Ronnie「レジは全部ネイティブに」
//   NativeSetupSheet     … 空席の卓に通すとき（モード・プラン・男女の人数・来店経路・時間制・開始時間）＝ Web の HandySetupScreen
//   NativeGuestInfoSheet … 着席中の卓の直し（開始・時間・人数・モード・プラン・コース）＝ Web の SeatTimeDialog

private let NF_PLAN_ORDER = ["normal", "drink", "buffet", "food", "course"]
private let NF_DURATIONS = [60, 90, 120, 150, 180]

/// 「HH:MM」（日本時間）
private func nfHm(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "ja_JP")
    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
    f.dateFormat = "HH:mm"
    return f.string(from: date)
}

private func nfDurationLabel(_ m: Int) -> String {
    let h = m / 60, r = m % 60
    if h == 0 { return "\(r)分" }
    return r == 0 ? "\(h)時間" : "\(h)時間\(r)分"
}

// MARK: - 来店登録（空席 → 注文）
// Web のハンディ・レジの「お客様情報」（components/handy/handy-setup-screen.tsx）と同じ並び：
//   テーブル／モード → タイマー設定（時間制・終了前注意・開始時間）→ 人数（男性・女性 1〜5・＋）→ 来店経路 → 確定
// 色はオーダー・会計の青と、来店経路の各社の色（2026-10-24 Ronnie「レイアウトは今の画面のまま、色を合わせて」）

/// 着席中の伝票を、来店登録と同じ画面で直すとき（2026-10-24 Ronnie「manxe ko tauko ma click garda start ko jastai sabai 変更、same popup」）
struct NFVisitEdit: Hashable {
    let order: NFOrder
    let slip: NFSlip
}

/// GET part=visitEdit の返事（伝票メモから読めたもの）
struct NFVisitFromMemo: Decodable {
    let plans: [String]?
    let male: Int?
    let female: Int?
    let source: String?
    let timed: Bool
    let duration: Int?
    let warningEnabled: Bool
    let warningMinutes: Int?
}
private struct NFVisitEditPayload: Decodable { let ok: Bool; let visit: NFVisitFromMemo? }

struct NativeSetupSheet: View {
    @ObservedObject var model: NativeFloorModel
    let table: NFTable
    /// 着席中の直し（nil＝空席の来店登録）
    var edit: NFVisitEdit? = nil
    /// Also used inside the table popup, so floor and ledger share one editor.
    var embedded = false
    let onClose: () -> Void
    let onStarted: (String) -> Void

    /// 直しのとき：最初の値を入れ終えたか・開始時間を変えたか・席のコース
    @State private var prefilled = false
    @State private var startChanged = false
    @State private var courseId: String?

    @State private var plans: [String] = ["normal"]
    @State private var planItemIds: [String] = []
    @State private var guests = 0
    @State private var source = ""
    // 時間制は最初から ON・2時間、終了前注意は ON・30分前（2026-10-24 Ronnie）
    @State private var timed = true
    @State private var duration = 120
    @State private var warningEnabled = true
    @State private var warningMinutes = 30
    @State private var startNow = true
    @State private var startDate = Date()
    @State private var saving = false
    @State private var problem: String?
    /// 小さなポップアップ（モード・プラン・時間制・終了前注意・開始時間）
    @State private var popup: NFSetupPopup?
    /// 人数のテンキー：もう 1 けためを打ったか（最初の数字は前の人数を置きかえる）
    @State private var guestTyped = false
    /// テンキーの数（ポップアップの中で入れる）
    @State private var padText = ""
    @State private var padReplaceOnDigit = false
    /// 顧客（電話番号で探して伝票に付ける。USEN の「顧客名 設定」）
    @State private var customer: NFCustomerHit?
    @State private var custPhone = ""
    @State private var custHits: [NFCustomerHit] = []
    @State private var custSearching = false

    private var payload: NFPayload? { model.payload }
    private var planItems: [NFPlanItem] { (payload?.planItems ?? []).filter { plans.contains($0.kind) } }
    private var planNames: String {
        let names = payload?.plans ?? []
        return plans.compactMap { id in names.first { $0.id == id }?.name }.joined(separator: "・")
    }
    private var pickedPlanNames: String {
        (payload?.planItems ?? []).filter { planItemIds.contains($0.id) }.map(\.name).joined(separator: "・")
    }
    /// 来店経路はここでは選ばない（予約の卓は予約の経路、ほかは会計で選ぶ。2026-10-24 Ronnie「FIRST MA TABLE 入力 GARDA GARNU PARDAINA」）
    private var canConfirm: Bool { guests >= 1 && !saving && (edit == nil || prefilled) }
    /// この卓の今の予約（前後60分以内）の経路。決まった名前なら来店登録にそのまま入れる
    private var bookedSource: String? {
        let r = table.upcoming.first { abs($0.startMs - model.now) <= 60 * 60 * 1000 }
        guard let label = r?.sourceLabel, (payload?.visitSources ?? []).contains(where: { $0.label == label }) else { return nil }
        return label
    }
    /// 直しのとき、伝票にもう入っているプラン商品（もう一度は入れない）
    private var slipMenuItemIds: [String] { edit?.slip.lines.compactMap { $0.menuItemId } ?? [] }
    /// 顧客名（直しのときは伝票の顧客 → 予約のお名前）
    private var shownName: String? {
        if let n = edit?.order.customerName?.trimmingCharacters(in: .whitespaces), !n.isEmpty { return n }
        return bookedName
    }
    /// この卓の今の予約（前後60分以内）のお名前
    private var bookedName: String? {
        let r = table.upcoming.first { abs($0.startMs - model.now) <= 60 * 60 * 1000 }
        guard let n = r?.name.trimmingCharacters(in: .whitespaces), !n.isEmpty else { return nil }
        return n
    }

    /// 横に広く・1画面に収まる（スクロールしない）2列（2026-10-24 Ronnie「USEN のようにコンパクトに、機能を多く。横は広げてよい」）
    ///   左：テーブル・モード・プラン／タイマー設定（時間制・終了前注意・開始時間）／人数　右：来店経路
    var body: some View {
        VStack(spacing: 0) {
            if !embedded {
            NFCardHeader(title: table.name, en: "") {
                Button(action: onClose) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left").font(.system(size: 16, weight: .bold))
                        VStack(alignment: .leading, spacing: 0) {
                            Text(edit == nil ? "テーブル一覧" : "戻る").font(.system(size: 15, weight: .bold))
                            Text(edit == nil ? "Tables" : "Back").font(.system(size: 10)).opacity(0.75)
                        }
                    }
                    .foregroundColor(GIColor.navy)
                }
                .buttonStyle(.plain)
            } right: { EmptyView() }
            }

            // 入るならそのまま、入らない画面（縦向きなど）だけスクロール
            ViewThatFits(in: .vertical) {
                AnyView(columns)
                ScrollView(showsIndicators: false) { AnyView(columns) }
            }

            // キャンセル・確定は人数のテンキーの右へ（2026-10-27 19:35 Ronnie「sidai keyboard rakhdeu、1234 pardaina、milayera rakha」）。
            // 下はうまくいかなかったときの赤い字だけ（案内の文は出さない）
            if let problem {
                Text(problem).font(.system(size: 13)).foregroundColor(NFColor.danger).lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 18).padding(.vertical, 8)
            }
        }
        // 卓のポップアップの中では、テンキーなどの小窓が入る高さまで広げる（下のボタンと重ならない。2026-10-27 19:32 Ronnie の写真）
        .frame(minHeight: embedded && popup != nil ? 600 : nil, alignment: .top)
        .overlay {
            if let pp = popup {
                ZStack {
                    Color.black.opacity(0.18).ignoresSafeArea().onTapGesture { popup = nil }
                    AnyView(popupCard(pp))
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: popup)
        .task {
            await prefill()
            // 見本：人数のテンキーを開いておく（-tenpoPreviewPad YES。画面の確認用）
            if UserDefaults.standard.bool(forKey: "tenpoPreviewPad") { openPad(.guests) }
        }
    }

    /// 来店経路の列は出さない（会計で選ぶ）
    private var columns: some View {
        AnyView(leftColumn).frame(maxWidth: .infinity)
            .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 8)
    }

    // MARK: 左の列

    private var leftColumn: some View {
        VStack(alignment: .leading, spacing: 8) {
            card {
                if !embedded {
                row("テーブル", en: "Table") { Text(table.name).font(.system(size: 17, weight: NT.strong)).foregroundColor(NFColor.ink) }
                rowDivider
                }
                row("モード", en: "Mode") {
                    valueText(planNames, on: true)
                    toggleSlot(nil, enabled: false)
                    setButton { popup = .mode }
                }
                if plans.contains(where: { $0 != "normal" }) || courseId != nil {
                    rowDivider
                    row("プラン", en: "Plan") {
                        valueText(pickedPlanNames.isEmpty ? (edit?.order.course?.label ?? "未設定") : pickedPlanNames, on: !pickedPlanNames.isEmpty || courseId != nil)
                        toggleSlot(nil, enabled: false)
                        setButton { popup = .plan }
                    }
                }
                if shownName != nil {
                rowDivider
                // 顧客名は予約（店舗台帳）から自動で出す。探すボタンは置かない（2026-10-24 Ronnie「予約にあれば自動で出る」）
                row("顧客名", en: "Name") {
                    valueText(shownName.map { "\($0) 様" } ?? "未登録", on: shownName != nil)
                    toggleSlot(nil, enabled: false)
                    Color.clear.frame(width: 64, height: 32)
                }
                }
            }
            card {
                // どの行も同じ列にそろえる：値（右寄せ）→ スイッチ → 設定（2026-10-27 19:44 Ronnie「時間 lai agadi yeslai paxadi、design いっち」）
                row("時間制", en: "Time limit") {
                    valueText(timed ? nfDurationLabel(duration) : "設定なし", on: timed)
                    toggleSlot($timed, enabled: true)
                    setButton(enabled: timed) { popup = .duration }
                }
                rowDivider
                row("終了前注意", en: "Last call") {
                    valueText(timed && warningEnabled ? "\(warningMinutes)分前" : "設定なし", on: timed && warningEnabled)
                    toggleSlot($warningEnabled, enabled: timed)
                    setButton(enabled: timed && warningEnabled) { popup = .warning }
                }
                rowDivider
                row("開始時間", en: "Start time") {
                    valueText(timed ? "\(nfHm(effectiveStart))〜\(nfHm(effectiveStart.addingTimeInterval(Double(duration) * 60)))" : "\(nfHm(effectiveStart))〜", on: true)
                    toggleSlot(nil, enabled: false)
                    setButton { popup = .start }
                }
                // ラストオーダーの時刻（終わりから「終了前注意」の分だけ前。時間制のときだけ。2026-10-27 19:45 Ronnie「last order time pani need」）
                if timed {
                    rowDivider
                    row("ラストオーダー", en: "Last order") {
                        valueText(nfHm(effectiveStart.addingTimeInterval(Double(duration - (warningEnabled ? warningMinutes : 0)) * 60)), on: true)
                        toggleSlot(nil, enabled: false)
                        Color.clear.frame(width: 64, height: 32)
                    }
                }
            }
            card {
                guestPad.padding(10)
            }
        }
    }

    // MARK: ポップアップ（USEN の「設定」と同じく、押すと小さなカードで選ぶ。色・形はうちの）

    @ViewBuilder private func popupCard(_ pp: NFSetupPopup) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(pp.title).font(.system(size: 20, weight: .bold)).foregroundColor(NFColor.ink)
                    Text(pp.en).font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.ink3)
                }
                Spacer()
                Button { popup = nil } label: {
                    Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).font(.system(size: 26)).foregroundColor(.secondary)
                }.buttonStyle(.plain)
            }
            switch pp {
            case .mode:
                NFChipGrid(items: (payload?.plans ?? []).map { ($0.id, $0.name, GIColor.navy, false) }, selected: plans, columns: 3, height: 56) { id in togglePlan(id) }
                Text("何個でも選べます（例：アラカルト＋飲み放題）／ Multiple OK").font(.system(size: 11)).foregroundColor(NFColor.ink3)
            case .plan:
                if planItems.isEmpty {
                    Text("メニューにコース・飲み放題・食べ放題の商品がありません（設定 → メニュー で商品の種別を「コース」「飲み放題」「食べ放題」にすると、ここに出ます）。プラン無しで続けられます。")
                        .font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("\(planNames)のプラン（何個でも。選ぶと伝票に入ります）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    NFChipGrid(items: planItems.map { ($0.id, slipMenuItemIds.contains($0.id) ? "\($0.name)（伝票にあり）" : "\($0.name)  ¥\($0.price)", GIColor.navy, false) }, selected: planItemIds + slipMenuItemIds, columns: 2, height: 56, lines: 3) { id in
                        guard !slipMenuItemIds.contains(id) else { return }
                        if planItemIds.contains(id) { planItemIds.removeAll { $0 == id } } else { planItemIds.append(id) }
                        if let item = planItems.first(where: { $0.id == id }), item.kind == "course", let m = item.durationMinutes, m > 0, planItemIds.contains(id) {
                            timed = true; duration = m
                        }
                    }
                    if !planItemIds.isEmpty {
                        Button("プランを全部外す") { planItemIds = [] }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger)
                    }
                }
            case .duration:
                Text(nfDurationLabel(duration)).font(.system(size: 24, weight: NT.strong, design: .rounded)).monospacedDigit().foregroundColor(GIColor.blue)
                    .frame(maxWidth: .infinity)
                pickerLabel("時間 / Hours")
                HStack(spacing: 8) {
                    ForEach(0...3, id: \.self) { hh in timeChip("\(hh)時間", on: duration / 60 == hh) { duration = max(15, hh * 60 + duration % 60) } }
                }
                pickerLabel("分 / Minutes")
                HStack(spacing: 8) {
                    ForEach([0, 15, 30, 45], id: \.self) { mm in timeChip("\(mm)分", on: duration % 60 == mm) { duration = max(15, (duration / 60) * 60 + mm) } }
                }
                HStack(spacing: 8) {
                    timeChip("−30分", on: false) { duration = max(15, duration - 30) }
                    timeChip("＋30分", on: false) { duration = min(600, duration + 30) }
                    timeChip("カスタム / Custom", on: false) { openPad(.duration) }
                }
            case .warning:
                Text("\(warningMinutes)分前").font(.system(size: 24, weight: NT.strong, design: .rounded)).monospacedDigit().foregroundColor(GIColor.blue)
                    .frame(maxWidth: .infinity)
                HStack(spacing: 8) {
                    ForEach([10, 15, 30], id: \.self) { mm in timeChip("\(mm)分前", on: warningMinutes == mm) { warningMinutes = mm } }
                }
                HStack(spacing: 8) {
                    ForEach([45, 60], id: \.self) { mm in timeChip("\(mm)分前", on: warningMinutes == mm) { warningMinutes = mm } }
                    timeChip("カスタム / Custom", on: false) { openPad(.warning) }
                }
            case .customer:
                Text("電話番号で探す / Search by phone").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
                HStack {
                    Text(custPhone.isEmpty ? "090…" : custPhone).font(.system(size: 26, weight: NT.strong, design: .rounded)).monospacedDigit()
                        .foregroundColor(custPhone.isEmpty ? NFColor.ink3 : GIColor.navy)
                    Spacer()
                    if custSearching { ProgressView() }
                }
                .padding(.horizontal, 14).frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.85)))
                ForEach([["1", "2", "3", "4", "5"], ["6", "7", "8", "9", "0"]], id: \.self) { keys in
                    HStack(spacing: 6) {
                        ForEach(keys, id: \.self) { k in
                            timeChip(k, on: false) { if custPhone.count < 13 { custPhone += k; Task { await searchCustomer() } } }
                        }
                    }
                }
                HStack(spacing: 6) {
                    timeChip("C", on: false) { custPhone = ""; custHits = [] }
                    timeChip("⌫", on: false) { custPhone = String(custPhone.dropLast()); Task { await searchCustomer() } }
                }
                if custHits.isEmpty {
                    Text(custPhone.count < 2 ? "2桁以上入れると候補が出ます / Type 2+ digits" : (custSearching ? " " : "見つかりません / No match"))
                        .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                } else {
                    VStack(spacing: 6) {
                        ForEach(custHits) { c in
                            Button { customer = c; popup = nil } label: {
                                HStack {
                                    Text("\(c.name) 様").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.ink)
                                    Spacer()
                                    Text(c.phone ?? "").font(.system(size: 14)).monospacedDigit().foregroundColor(NFColor.ink3)
                                }
                                .padding(.horizontal, 14).frame(height: 46)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(customer?.id == c.id ? GIColor.navySoft : Color.white.opacity(0.9)))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            case .pad(let t):
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Spacer()
                    Text(padText.isEmpty ? "0" : padText).font(.system(size: 34, weight: NT.strong, design: .rounded)).monospacedDigit().foregroundColor(GIColor.navy)
                    Text(t.unit).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink3)
                }
                .padding(.horizontal, 14).frame(height: 56)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.85)))
                ForEach([["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], ["C", "0", "⌫"]], id: \.self) { keys in
                    HStack(spacing: 8) {
                        ForEach(keys, id: \.self) { k in
                            Button { padKey(k) } label: {
                                Group {
                                    if k == "⌫" { Image(systemName: "delete.left").font(.system(size: 20, weight: .semibold)) }
                                    else { Text(k).font(.system(size: 22, weight: .bold, design: .rounded)) }
                                }
                                .foregroundColor(k == "C" ? NFColor.danger : NFColor.ink)
                                .frame(maxWidth: .infinity).frame(height: 58)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white.opacity(0.9)))
                                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color.black.opacity(0.06), lineWidth: 0.8))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            case .start:
                HStack(spacing: 8) {
                    timeChip("今 / Now", on: startNow) { startNow = true; startChanged = true }
                    timeChip("時刻を選ぶ / Pick", on: !startNow) {
                        if startNow {
                            startNow = false
                            let c = nfJstCalendar
                            setStart(hour: c.component(.hour, from: Date()), minute: (c.component(.minute, from: Date()) / 5) * 5)
                        }
                    }
                }
                if !startNow {
                    let cal = nfJstCalendar
                    let h = cal.component(.hour, from: startDate)
                    let m = cal.component(.minute, from: startDate)
                    HStack(spacing: 0) {
                        Picker("時", selection: Binding(get: { h }, set: { setStart(hour: $0, minute: m) })) {
                            ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                        }
                        .pickerStyle(.wheel).frame(width: 120, height: 150).clipped()
                        Text(":").font(.system(size: 24, weight: .bold))
                        Picker("分", selection: Binding(get: { (m / 5) * 5 }, set: { setStart(hour: h, minute: $0) })) {
                            ForEach(Array(stride(from: 0, to: 60, by: 5)), id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                        }
                        .pickerStyle(.wheel).frame(width: 120, height: 150).clipped()
                    }
                    .frame(maxWidth: .infinity)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.7)))
                    HStack(spacing: 8) {
                        ForEach([0, 15, 30, 45], id: \.self) { mm in timeChip(String(format: ":%02d", mm), on: m == mm) { setStart(hour: h, minute: mm) } }
                    }
                }
            }
            Button { applyPopup(pp); popup = nil } label: {
                HStack(spacing: 6) {
                    Text("設定").font(.system(size: 18, weight: NT.strong))
                    Text("Set").font(.system(size: 12, weight: .bold)).opacity(0.8)
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(GIColor.navy))
            }
            .buttonStyle(PressableStyle(scale: 0.98))
        }
        .padding(20)
        .frame(width: 500)
        .background(NT.page, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 28, y: 12)
    }

    private func togglePlan(_ id: String) {
        if plans.contains(id) {
            if plans.count > 1 { plans.removeAll { $0 == id } }
        } else {
            plans.append(id)
        }
        planItemIds.removeAll { pid in !(planItems.contains { $0.id == pid }) }
    }

    private func confirm() async {
        guard guests >= 1 else { problem = "人数を入れてください"; return }
        // 来店経路：直しのときは今のまま（空なら変えない）、来店登録は予約の経路（無ければ空＝会計で選ぶ）
        if edit == nil { source = bookedSource ?? "" }
        saving = true
        defer { saving = false }
        var draft: [String: Any] = [
            "plans": plans.sorted { (NF_PLAN_ORDER.firstIndex(of: $0) ?? 9) < (NF_PLAN_ORDER.firstIndex(of: $1) ?? 9) },
            "planItemIds": planItemIds,
            "male": 0,
            "female": 0,
            "guestCount": guests,
            "source": source,
            "timed": timed,
            "duration": duration,
            "warningEnabled": timed && warningEnabled,
            "warningMinutes": warningMinutes,
        ]
        if let e = edit {
            // 直し：開始時間は変えたときだけ（今 → いまの時刻）。コースのプランを選んだら席のコースもそれに
            draft["startTime"] = startChanged ? nfHm(startNow ? Date() : startDate) : NSNull()
            let seatCourses = payload?.seatCourses ?? []
            let pickedCourse = planItemIds.first { id in seatCourses.contains { $0.id == id } }
            let cid = pickedCourse ?? courseId
            // durationIsLastOrder：時間制は L.O. までの時間（古いアプリと見分ける。サーバーの legacyEditDuration）
            if let _ = await model.act(["type": "visitEdit", "orderId": e.slip.id, "draft": draft, "courseId": cid.map { $0 as Any } ?? NSNull(), "durationIsLastOrder": true]) {
                if let c = customer { _ = await model.act(["type": "orderCustomer", "orderId": e.slip.id, "customerId": c.id]) }
                model.show(toast: planItemIds.isEmpty ? "お客様情報を変更しました" : "お客様情報を変更し、\(planItemIds.count)品を伝票に入れました")
                onClose()
            } else {
                problem = model.error
            }
            return
        }
        draft["startTime"] = startNow ? NSNull() : nfHm(startDate)
        if let r = await model.act(["type": "floorStart", "tableId": table.id, "draft": draft]), let id = r.orderId {
            if let e = r.planItemError, !e.isEmpty { model.show(toast: e) }
            if let c = customer { _ = await model.act(["type": "orderCustomer", "orderId": id, "customerId": c.id]) }
            onStarted(id)
        } else {
            problem = model.error
        }
    }

    /// 直しのとき：今の伝票の値を入れる（モード・人数・来店経路・時間制・終了前注意・開始時間・コース）
    private func prefill() async {
        guard let e = edit, !prefilled else { return }
        let o = e.order
        plans = o.plansOrDefault
        courseId = o.courseId
        startNow = false
        startDate = Date(timeIntervalSince1970: o.openedAtMs / 1000)
        // テーブル一覧の終わりは「時間制（＝L.O.）＋30 分」（2026-10-25 #568）。直しの時間制は L.O. までの時間に戻す
        let dur = Int(((o.endAtMs - o.openedAtMs) / 60_000).rounded())
        timed = dur > 0
        if dur > 0 { duration = max(15, dur - NF_LAST_ORDER_WARN_MINUTES) }
        guests = e.slip.guestCount
        let labels = (payload?.visitSources ?? []).map(\.label)
        if labels.contains(o.sourceLabel) { source = o.sourceLabel }
        // 伝票メモ（来店登録で入れたもの）から男女・時間制・終了前注意
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "visitEdit"), URLQueryItem(name: "orderId", value: e.slip.id)]
        if let data = try? await NativeAPI.shared.send(URLRequest(url: comps.url!)),
           let r = try? JSONDecoder().decode(NFVisitEditPayload.self, from: data), let v = r.visit {
            if let s = v.source, source.isEmpty, labels.contains(s) { source = s }
            timed = v.timed
            // 来店登録で入れた時間制（＝L.O. までの時間）があれば、それをそのまま
            if v.timed, let d = v.duration, d > 0 { duration = d }
            warningEnabled = v.warningEnabled
            if let w = v.warningMinutes { warningMinutes = w }
        }
        prefilled = true
    }

    // MARK: 部品

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NFColor.line, lineWidth: 1))
    }

    private var rowDivider: some View { Rectangle().fill(NFColor.line).frame(height: 1).padding(.leading, 14) }

    private func heading(_ ja: String, en: String, required: Bool = false) -> some View {
        // 英語は日本語の下に小さく（2026-10-27 19:07 Ronnie「everywhere english japanese ko tala lekha」）
        HStack(alignment: .top, spacing: 4) {
            VStack(alignment: .leading, spacing: 0) {
                Text(ja).font(.system(size: 15, weight: NT.strong)).foregroundColor(NFColor.ink)
                Text(en).font(.system(size: 10)).foregroundColor(NFColor.ink3)
            }
            if required { Text("＊").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.danger) }
        }
    }

    private func row<Right: View>(_ ja: String, en: String, @ViewBuilder right: () -> Right) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(ja).font(.system(size: 16)).foregroundColor(NFColor.ink2)
                Text(en).font(.system(size: 10)).foregroundColor(NFColor.ink3)
            }
            .frame(width: 112, alignment: .leading)
            Spacer(minLength: 4)
            right()
        }
        .padding(.horizontal, 14)
        .frame(minHeight: embedded ? 40 : 46)
    }

    /// 開始時間（今から／決めた時刻）
    private var effectiveStart: Date { startNow && (edit == nil || startChanged) ? model.nowDate : startDate }

    /// スイッチの列（無い行も同じ幅を空けて、値と「設定」の列をそろえる）
    @ViewBuilder private func toggleSlot(_ on: Binding<Bool>?, enabled: Bool) -> some View {
        if let on {
            Toggle("", isOn: on).labelsHidden().tint(GIColor.blue).disabled(!enabled)
                .scaleEffect(0.8).frame(width: 52, height: 32)
        } else {
            Color.clear.frame(width: 52, height: 32)
        }
    }

    private func valueText(_ t: String, on: Bool) -> some View {
        Text(t).font(.system(size: 15, weight: .medium)).monospacedDigit()
            .foregroundColor(on ? NFColor.ink2 : NFColor.ink3).lineLimit(3).fixedSize(horizontal: false, vertical: true)
    }

    private func setButton(enabled: Bool = true, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            // 時間の横のボタンは「設定」（2026-10-27 19:35 Ronnie「time ko side ma 変更 lai 設定 banau」）
            Text("設定").font(.system(size: 14, weight: .medium)).foregroundColor(GIColor.navy)
                .frame(width: 64, height: 32)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(GIColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
    }

    private func searchCustomer() async {
        let q = custPhone
        guard q.count >= 2 else { custHits = []; return }
        custSearching = true
        defer { custSearching = false }
        var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "part", value: "customerSearch"), URLQueryItem(name: "phone", value: q)]
        guard let data = try? await NativeAPI.shared.send(URLRequest(url: comps.url!)),
              let r = try? JSONDecoder().decode(NFCustomerSearch.self, from: data), q == custPhone else { return }
        custHits = r.results
    }

    private func openPad(_ t: NFPadTarget) {
        let v = padInitial(t)
        padText = v > 0 ? String(v) : ""
        padReplaceOnDigit = true
        popup = .pad(t)
    }

    private func padKey(_ k: String) {
        switch k {
        case "C": padText = ""; padReplaceOnDigit = false
        case "⌫": padText = String(padText.dropLast()); padReplaceOnDigit = false
        default:
            if padReplaceOnDigit { padText = ""; padReplaceOnDigit = false }
            var t = padText + k
            while t.count > 1 && t.hasPrefix("0") { t.removeFirst() }
            if t.count <= 3 { padText = t }
        }
    }

    /// 「設定」を押したとき（テンキーの数を入れる）
    private func applyPopup(_ pp: NFSetupPopup) {
        guard case .pad(let t) = pp else { return }
        let v = Int(padText) ?? 0
        switch t {
        case .guests, .male, .female: guests = min(999, v)
        case .duration: duration = min(600, max(15, v))
        case .warning: warningMinutes = min(180, max(5, v))
        }
    }

    private func padInitial(_ t: NFPadTarget) -> Int {
        switch t {
        case .guests, .male, .female: return guests
        case .duration: return duration
        case .warning: return warningMinutes
        }
    }

    private func pickerLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
    }

    private func timeChip(_ t: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 17, weight: .bold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
                .foregroundColor(on ? .white : GIColor.navy)
                .frame(maxWidth: .infinity).frame(height: 52)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? GIColor.navy : Color.white.opacity(0.85)))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Color.clear : GIColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }

    /// 開始時間を「時・分」で決める。前日・今日・翌日のうち「12時間前〜6時間後」に入る日時（サーバーの resolveStartTime と同じ）。
    /// 先の時間（あとから始める・サービス）も選べる（2026-10-25 19:34 Ronnie「start 時間は先の時間にも設定できるようにして」）
    private func setStart(hour: Int, minute: Int) {
        startDate = nfResolveStart(hour: hour, minute: minute)
        startChanged = true
    }

    /// 人数：テンキーをそのまま出す（1〜5 のボタンはやめる）。右にキャンセル・確定
    /// （2026-10-27 19:35 Ronnie「sidai keyboard rakhdeu、1234 pardaina、milayera rakha」。店舗台帳の受付のテンキーと同じ並び）
    private var guestPad: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 8) {
                HStack(alignment: .lastTextBaseline) {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("人数").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2)
                        Text("Guests").font(.system(size: 10)).foregroundColor(NFColor.ink3)
                    }
                    Spacer(minLength: 4)
                    Text(guests > 0 ? "\(guests)" : "—").font(.system(size: 30, weight: .semibold)).monospacedDigit().foregroundColor(NFColor.ink)
                    Text("名").font(.system(size: 14)).foregroundColor(NFColor.ink3)
                }
                .padding(.horizontal, 4)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                    ForEach(["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"], id: \.self) { k in
                        Button { guestKey(k) } label: {
                            Group {
                                if k == "⌫" { Image(systemName: "delete.left") } else { Text(k) }
                            }
                            .font(.system(size: 22, weight: .medium)).monospacedDigit()
                            .foregroundColor(k == "C" ? NFColor.danger : NFColor.ink)
                            .frame(maxWidth: .infinity).frame(height: 48)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(GIColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle(scale: 0.94))
                    }
                }
            }
            VStack(spacing: 8) {
                Button { Task { await confirm() } } label: {
                    VStack(spacing: 2) {
                        Text(saving ? (edit == nil ? "作成中…" : "保存中…") : (edit == nil ? "確定" : "保存する")).font(.system(size: 20, weight: NT.strong))
                        Text(edit == nil ? "Start order" : "Save").font(.system(size: 11, weight: .bold)).opacity(0.8)
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(canConfirm ? GIColor.blue : GIColor.blue.opacity(0.35)))
                }
                .buttonStyle(PressableStyle(scale: 0.98))
                .disabled(!canConfirm)
                Button(action: onClose) {
                    Text("キャンセル").font(.system(size: 16, weight: .bold)).foregroundColor(GIColor.navy)
                        .frame(maxWidth: .infinity).frame(height: 52)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(GIColor.line, lineWidth: 1.2))
                }
                .buttonStyle(PressableStyle(scale: 0.98))
            }
            .frame(width: 140)
            .frame(maxHeight: .infinity)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// テンキーの 1 押し：最初の数字は今の人数を置きかえる。C＝0、⌫＝1 けた消す
    private func guestKey(_ k: String) {
        switch k {
        case "C": guests = 0; guestTyped = false
        case "⌫": guests /= 10; guestTyped = true
        default:
            guard let d = Int(k) else { return }
            if !guestTyped { guests = d; guestTyped = true } else if guests * 10 + d <= 999 { guests = guests * 10 + d }
        }
    }

    /// 1〜5 のクイック選択と、人数を直接入力するテンキー。
    private func countRow(_ ja: String, en: String, value: Binding<Int>, target: NFPadTarget) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text(ja).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2)
                Text(en).font(.system(size: 10)).foregroundColor(NFColor.ink3)
            }
            .frame(width: 84, alignment: .leading)
            ForEach(1...5, id: \.self) { n in
                let on = value.wrappedValue == n
                Button { value.wrappedValue = on ? 0 : n } label: {
                    Text("\(n)").font(.system(size: 20, weight: .medium))
                        .foregroundColor(on ? .white : GIColor.navy)
                        .frame(maxWidth: .infinity).frame(height: 48)
                        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(on ? GIColor.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(on ? Color.clear : GIColor.line, lineWidth: 1.2))
                }
                .buttonStyle(PressableStyle())
            }
            let more = value.wrappedValue > 5
            Button { openPad(target) } label: {
                VStack(spacing: 2) {
                    HStack(spacing: 4) {
                        Image(systemName: "keyboard")
                        if more { Text("\(value.wrappedValue)").monospacedDigit() }
                    }
                    .font(.system(size: 18, weight: .medium))
                    Text("テンキー").font(.system(size: 10, weight: .medium))
                }
                    .foregroundColor(more ? .white : GIColor.navy)
                    .frame(width: 76, height: 48)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(more ? GIColor.navy : Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(more ? Color.clear : GIColor.line, lineWidth: 1.2))
            }
            .buttonStyle(PressableStyle())
            .accessibilityLabel("人数をテンキーで入力")
            // クリア（文字でなくアイコン。2026-10-24 Ronnie）
            Button { value.wrappedValue = 0 } label: {
                Image(systemName: "delete.left").font(.system(size: 20, weight: .semibold))
                    .foregroundColor(value.wrappedValue > 0 ? NFColor.ink : NFColor.ink3)
                    .frame(width: 56, height: 48)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NFColor.line, lineWidth: 1.2))
            }
            .buttonStyle(PressableStyle())
            .disabled(value.wrappedValue == 0)
        }
    }
}

/// 来店登録の小さなポップアップ
enum NFSetupPopup: Equatable {
    case mode, plan, duration, warning, start, customer
    case pad(NFPadTarget)
    var title: String {
        switch self {
        case .mode: return "モード"
        case .plan: return "プラン"
        case .duration: return "時間制"
        case .warning: return "終了前注意"
        case .start: return "開始時間"
        case .customer: return "顧客名"
        case .pad(let t): return t.title
        }
    }
    var en: String {
        switch self {
        case .mode: return "Mode"
        case .plan: return "Plan"
        case .duration: return "Time limit"
        case .warning: return "Last call"
        case .start: return "Start time"
        case .customer: return "Customer"
        case .pad(let t): return t.en
        }
    }
}

// MARK: - 着席中の直し（席の時間・コース・人数・モード）

struct NativeGuestInfoSheet: View {
    @ObservedObject var model: NativeFloorModel
    let order: NFOrder
    let slip: NFSlip
    let onClose: () -> Void

    @State private var startDate: Date
    @State private var startChanged = false
    @State private var minutes: Int?
    @State private var courseId: String
    @State private var guests: Int
    @State private var plans: [String]
    @State private var planPick: [String] = []
    @State private var saving = false
    @State private var problem: String?

    init(model: NativeFloorModel, order: NFOrder, slip: NFSlip, onClose: @escaping () -> Void) {
        self.model = model
        self.order = order
        self.slip = slip
        self.onClose = onClose
        _startDate = State(initialValue: Date(timeIntervalSince1970: order.openedAtMs / 1000))
        // テーブル一覧の終わりは「時間制（＝L.O.）＋30 分」（#568）。ここで選ぶ時間は L.O. までの時間
        let dur = Int(((order.endAtMs - order.openedAtMs) / 60_000).rounded())
        _minutes = State(initialValue: dur > 0 ? max(15, dur - NF_LAST_ORDER_WARN_MINUTES) : nil)
        _courseId = State(initialValue: order.courseId ?? "")
        _guests = State(initialValue: slip.guestCount)
        _plans = State(initialValue: order.plansOrDefault)
    }

    private var payload: NFPayload? { model.payload }
    private var courses: [NFSeatCourse] { payload?.seatCourses ?? [] }
    private var planItems: [NFPlanItem] { (payload?.planItems ?? []).filter { $0.kind != "normal" && plans.contains($0.kind) } }
    private var orderMenuItemIds: [String] { slip.lines.compactMap { $0.menuItemId } }
    private var endLabel: String {
        guard let m = minutes else { return "—" }
        // 席の終わり＝L.O.（開始＋時間）＋30 分
        return nfHm(startDate.addingTimeInterval(Double(m + NF_LAST_ORDER_WARN_MINUTES) * 60))
    }

    var body: some View {
        VStack(spacing: 0) {
            NFCardHeader(title: "お客様情報", en: "Guest info") {
                Button(action: onClose) {
                    VStack(spacing: 0) {
                        Text("キャンセル").font(.system(size: 15, weight: .bold))
                        Text("Cancel").font(.system(size: 10)).opacity(0.75)
                    }
                    .foregroundColor(NFColor.ink2)
                }
                .buttonStyle(.plain)
            } right: {
                Button { Task { await save() } } label: {
                    VStack(spacing: 0) {
                        Text(saving ? "保存中…" : "保存する").font(.system(size: 16, weight: NT.strong))
                        Text("Save").font(.system(size: 10, weight: .bold)).opacity(0.8)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 18).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(GIColor.navy))
                }
                .buttonStyle(PressableStyle())
                .disabled(saving)
            }
            // AnyView で型を切る（中身を 2 回入れると View の型が深くなりすぎて実機で落ちる。2026-10-24）
            ViewThatFits(in: .vertical) {
                AnyView(main)
                ScrollView(showsIndicators: true) { AnyView(main) }
            }
        }
    }

    private var main: some View {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 24) {
                        NFSection("開始時間 / Start") {
                            DatePicker("", selection: Binding(get: { startDate }, set: { startDate = $0; startChanged = true }), in: Date().addingTimeInterval(-12 * 3600)...Date().addingTimeInterval(Double(NF_START_MAX_FUTURE_MINUTES) * 60), displayedComponents: .hourAndMinute)
                                .labelsHidden()
                                .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                        }
                        NFSection("終了予定 / End") {
                            Text(endLabel).font(.system(size: 26, weight: NT.strong)).monospacedDigit().foregroundColor(GIColor.navy)
                        }
                    }
                    NFSection("人数 / Guests") {
                        NFStepper(title: nil, value: $guests, min: 1, max: 999)
                    }
                    NFSection("モード / Mode") {
                        NFChipGrid(items: (payload?.plans ?? []).map { ($0.id, $0.name, GIColor.navy, false) }, selected: plans, columns: 5) { id in
                            if plans.contains(id) { if plans.count > 1 { plans.removeAll { $0 == id } } } else { plans.append(id) }
                            planPick.removeAll { pid in !(planItems.contains { $0.id == pid }) }
                        }
                        if !planItems.isEmpty {
                            Text("プラン / Plan（選ぶと伝票に入ります。注文確定で厨房へ）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                            NFChipGrid(
                                items: planItems.map { ($0.id, orderMenuItemIds.contains($0.id) ? "\($0.name)（伝票にあり）" : "\($0.name)  ¥\($0.price)", GIColor.navy, false) },
                                selected: planPick + orderMenuItemIds,
                                columns: 3,
                                lines: 3
                            ) { id in
                                guard !orderMenuItemIds.contains(id) else { return }
                                if planPick.contains(id) { planPick.removeAll { $0 == id } } else {
                                    planPick.append(id)
                                    // コースのプラン商品を選んだら、席のコース・時間もそれに合わせる
                                    if let c = courses.first(where: { $0.id == id }) { courseId = c.id; if let m = c.durationMinutes, m > 0 { minutes = m } }
                                }
                            }
                        }
                    }
                    NFSection("時間 / Duration") {
                        NFChipGrid(items: NF_DURATIONS.map { (String($0), nfDurationLabel($0), GIColor.navy, false) } + [("none", "制限なし", GIColor.navy, false)], selected: [minutes.map(String.init) ?? "none"], columns: 6) { v in
                            minutes = v == "none" ? nil : Int(v)
                        }
                    }
                    NFSection("コース / Course") {
                        Picker("コース", selection: $courseId) {
                            Text("なし（アラカルト） / None").tag("")
                            ForEach(courses) { c in
                                Text(c.name + (c.durationMinutes.map { "（\(nfDurationLabel($0))）" } ?? "")).tag(c.id)
                            }
                        }
                        .pickerStyle(.menu)
                        .tint(GIColor.navy)
                        .onChange(of: courseId) { id in
                            if let c = courses.first(where: { $0.id == id }), let m = c.durationMinutes, m > 0 { minutes = m }
                        }
                        Text("コースを選ぶと時間がコースの所要時間になります。コースの料金は今まで通り商品から伝票に入れてください。")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    if let p = problem { Text(p).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger) }
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func save() async {
        if let m = minutes, !(15...480).contains(m) { problem = "時間は15分〜8時間で入れてください"; return }
        saving = true
        defer { saving = false }
        let initialPlans = order.plansOrDefault
        var input: [String: Any] = [
            "startTime": startChanged ? nfHm(startDate) : NSNull(),
            "durationMinutes": minutes ?? NSNull(),
            "courseId": courseId.isEmpty ? NSNull() : courseId,
            "guestCount": guests != slip.guestCount ? guests : NSNull(),
            "planItemIds": planPick,
        ]
        input["plans"] = plans == initialPlans ? NSNull() : plans
        if let _ = await model.act(["type": "floorSeatTime", "orderId": slip.id, "input": input]) {
            model.show(toast: planPick.isEmpty ? "お客様情報を変更しました" : "お客様情報を変更し、\(planPick.count)品を伝票に入れました")
            onClose()
        } else {
            problem = model.error
        }
    }
}

// MARK: - 部品

/// カードの上のバー（左＝戻る／真ん中＝題（日本語大・英語小）／右＝保存など）
struct NFCardHeader<Left: View, Right: View>: View {
    let title: String
    let en: String
    @ViewBuilder let left: () -> Left
    @ViewBuilder let right: () -> Right

    init(title: String, en: String, @ViewBuilder left: @escaping () -> Left, @ViewBuilder right: @escaping () -> Right) {
        self.title = title; self.en = en; self.left = left; self.right = right
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                Text(title).font(.system(size: 18, weight: NT.strong)).foregroundColor(NFColor.ink)
                Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
            HStack {
                left()
                Spacer(minLength: 8)
                right()
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 58)
        .background(Color.white)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }
}

struct NFSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
            content()
        }
    }
}

/// チップの格子（id, 表示, 色, 選択中は文字を黒に）
struct NFChipGrid: View {
    let items: [(String, String, Color, Bool)]
    let selected: [String]
    var columns: Int = 4
    var height: CGFloat = 46
    /// 1 より大きいと折り返して出す（プラン名など長い名前を切らない。2026-10-26 Ronnie「文字 mileko chaina」）
    var lines: Int = 1
    let onTap: (String) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: columns), spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                let on = selected.contains(it.0)
                Button { onTap(it.0) } label: {
                    Text(it.1)
                        .font(.system(size: 14, weight: .bold))
                        .lineLimit(lines).minimumScaleFactor(lines > 1 ? 0.85 : 0.7)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: lines > 1)
                        .padding(.vertical, lines > 1 ? 6 : 0)
                        .foregroundColor(on ? .white : GIColor.navy)
                        .frame(maxWidth: .infinity, minHeight: height)
                        .padding(.horizontal, 6)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? GIColor.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? GIColor.navy : GIColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }
}

struct NFToggleChip: View {
    let text: String
    let on: Bool
    let action: () -> Void
    init(_ text: String, on: Bool, action: @escaping () -> Void) {
        self.text = text; self.on = on; self.action = action
    }
    var body: some View {
        Button(action: action) {
            Text(text).font(.system(size: 14, weight: .bold))
                .foregroundColor(on ? .white : NFColor.ink2)
                .padding(.horizontal, 16).frame(height: 44)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? GIColor.navy : Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
    }
}

struct NFStepper: View {
    let title: String?
    @Binding var value: Int
    var min: Int = 0
    var max: Int = 999

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title { Text(title).font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink3) }
            HStack(spacing: 8) {
                step("−", enabled: value > min) { value = Swift.max(min, value - 1) }
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text("\(value)").font(.system(size: 26, weight: NT.strong)).monospacedDigit().foregroundColor(GIColor.navy)
                    Text("名").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                }
                .frame(width: 96, height: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                step("＋", enabled: value < max) { value = Swift.min(max, value + 1) }
            }
        }
    }

    private func step(_ t: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 22, weight: .bold)).foregroundColor(GIColor.navy)
                .frame(width: 48, height: 48)
                .background(RoundedRectangle(cornerRadius: 12).fill(GIColor.navySoft))
        }
        .buttonStyle(PressableStyle())
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
    }
}

/// 開始時間：先の時間は 6 時間後まで（サーバーの START_MAX_FUTURE_MINUTES と同じ）。前は 12 時間前まで
let NF_START_MAX_FUTURE_MINUTES = 6 * 60
let NF_START_MAX_PAST_MINUTES = 12 * 60

/// 「時・分」を、前日・今日・翌日のうち「12時間前〜6時間後」に入る日時に（lib/handy-visit.ts の resolveStartTime と同じ）
func nfResolveStart(hour: Int, minute: Int, now: Date = Date()) -> Date {
    let cal = nfJstCalendar
    var c = cal.dateComponents([.year, .month, .day], from: now)
    c.hour = hour; c.minute = minute; c.second = 0
    let base = cal.date(from: c) ?? now
    let candidates = [-1, 0, 1].compactMap { cal.date(byAdding: .day, value: $0, to: base) }
    let lo = now.addingTimeInterval(-Double(NF_START_MAX_PAST_MINUTES) * 60)
    let hi = now.addingTimeInterval(Double(NF_START_MAX_FUTURE_MINUTES + 5) * 60)
    if let d = candidates.first(where: { $0 >= lo && $0 <= hi }) { return d }
    return candidates.min { abs($0.timeIntervalSince(now)) < abs($1.timeIntervalSince(now)) } ?? base
}

/// 日本時間のカレンダー（開始時間の「時・分」選び）
let nfJstCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = TimeZone(identifier: "Asia/Tokyo")!
    return c
}()


/// テンキーで入れるもの
enum NFPadTarget: Equatable {
    case guests, male, female, duration, warning
    var title: String {
        switch self {
        case .guests: return "人数"
        case .male: return "男性の人数"
        case .female: return "女性の人数"
        case .duration: return "時間制（分）"
        case .warning: return "終了前注意（何分前）"
        }
    }
    var unit: String { self == .guests || self == .male || self == .female ? "名" : "分" }
    var en: String {
        switch self {
        case .guests: return "Guests"
        case .male: return "Male"
        case .female: return "Female"
        case .duration: return "Minutes"
        case .warning: return "Minutes before"
        }
    }
}

/// 数を入れるテンキーのカード（C・7〜0・00・←・OK）。外を押すと閉じる
struct NFNumberPad: View {
    let title: String
    let unit: String
    let initial: Int
    let onDone: (Int?) -> Void
    @State private var text = ""

    var body: some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea().onTapGesture { onDone(nil) }
            VStack(spacing: 12) {
                HStack {
                    Text(title).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink)
                    Spacer()
                    Button { onDone(nil) } label: {
                        Image(systemName: "xmark.circle.fill").symbolRenderingMode(.hierarchical).font(.system(size: 26)).foregroundColor(.secondary)
                    }.buttonStyle(.plain)
                }
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Spacer()
                    Text(text.isEmpty ? "0" : text).font(.system(size: 40, weight: NT.strong, design: .rounded)).monospacedDigit().foregroundColor(GIColor.navy)
                    Text(unit).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink3)
                }
                .padding(.horizontal, 16).frame(height: 70)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NFColor.lilacSoft))
                key("C", fg: NFColor.danger, wide: true) { text = "" }
                ForEach([["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"]], id: \.self) { row in
                    HStack(spacing: 10) { ForEach(row, id: \.self) { k in key(k) { add(k) } } }
                }
                HStack(spacing: 10) { key("0") { add("0") }; key("00") { add("00") } }
                HStack(spacing: 10) {
                    key("←", fg: NFColor.ink2) { text = String(text.dropLast()) }
                    Button { onDone(Int(text) ?? 0) } label: {
                        Text("OK").font(.system(size: 22, weight: NT.strong)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 58)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(GIColor.navy))
                    }.buttonStyle(PressableStyle())
                }
            }
            .padding(18).frame(width: 340)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .shadow(color: .black.opacity(0.18), radius: 28, y: 12)
        }
        .onAppear { text = initial > 0 ? String(initial) : "" }
    }

    private func add(_ k: String) {
        var t = text + k
        while t.count > 1 && t.hasPrefix("0") { t.removeFirst() }
        if t.count <= 3 { text = t }
    }

    private func key(_ t: String, fg: Color = NFColor.ink, wide: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 24, weight: .bold, design: .rounded)).foregroundColor(fg)
                .frame(maxWidth: .infinity).frame(height: wide ? 50 : 58)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.85)))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.black.opacity(0.06), lineWidth: 0.8))
        }
        .buttonStyle(PressableStyle())
    }
}


/// 顧客の検索結果（Web の PosCustomerSearchResult）
struct NFCustomerHit: Codable, Identifiable, Hashable { let id: String; let name: String; let phone: String?; let pointBalance: Int }
struct NFCustomerSearch: Codable { let results: [NFCustomerHit] }
