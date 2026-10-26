import SwiftUI

// iPhone の店長・オーナー：シフト（/app/shifts）のネイティブ（2026-10-25 Ronnie「iPhone も native に」）。
// iPad の「スタッフ × 7日」の表は iPhone の幅に入らないので、週を日ごとの縦の一覧に（日 → スタッフ・時間）:
//   週の切り替え（前の週・次の週・今週）／今週分を公開（下書き → 公開。店長系）
//   日ごと：その日のシフト（時間・種別・下書き・変更申請中）。押すと iPad と同じシートで時間・種別の変更・削除・変更申請の却下・
//           もう1つ追加（店長系）／自分の希望を出す・直す・変更申請（スタッフ）。店長系は「＋」でその日にスタッフを足す
//   ＋追加（他店舗スタッフ＝店舗間ヘルプも）／人員不足・連勤・週の勤務時間・営業時間外の注意
//   人件費（日別の予定人件費・人件費率・予算との差、スタッフ別）／時間帯別 必要人数（追加・削除）
// サーバーは iPad と同じ GET part=shifts&week= と POST shift…（lib/native-modules/shifts.ts）。
// iPad の中身の形（NSHPayload …）・入力のシート（NSHCellSheet・NSHCreateSheet・NSHRequirementSheet）・NSHApi をそのまま使う（iPad は変えない）。
// 人件費が入るので iPhone にも残さない（NSHApi.load が読んだらすぐ保存を消す）。

// MARK: - 中身の持ち主

@MainActor
final class NPSHModel: ObservableObject {
    @Published var payload: NSHPayload?
    @Published var error: String?
    @Published var toast: NATToast?
    @Published var loading = false
    @Published var busy: String?
    private var week: String?
    private var seq = 0

    init(week: String?) { self.week = week }

    func load() async {
        // 見本（-tenpoNativePreview phoneShifts）は読み込まない
        if NativePreview.current != nil { return }
        seq += 1
        let mine = seq
        loading = true
        do {
            let p = try await NSHApi.load(week: week)
            guard mine == seq else { return }
            week = p.weekStart
            payload = p
            error = nil
        } catch {
            guard mine == seq else { return }
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NATToast(text: NativeModuleAPI.message(error), tone: .error) }
        }
        loading = false
    }

    func go(_ w: String?) {
        week = w
        Task { await load() }
    }

    func move(weeks n: Int) {
        guard let p = payload else { return }
        go(NSHFmt.addDays(p.weekStart, n * 7))
    }

    func post(_ req: [String: Any], key: String, done: String) async {
        if NativePreview.current != nil { toast = NATToast(text: "見本のため保存しません", tone: .warn); return }
        guard busy == nil else { return }
        busy = key
        let r = await NHXApi.post(req)
        busy = nil
        if r.ok {
            toast = NATToast(text: r.message ?? done)
            await load()
        } else {
            toast = NATToast(text: r.error ?? "保存できませんでした", tone: .error)
        }
    }

    func publish() async {
        guard let p = payload else { return }
        await post(["type": "shiftPublish", "weekStart": p.weekStart], key: "publish", done: "今週分のシフトを公開しました")
    }

    func deleteRequirement(_ id: String) async {
        await post(["type": "shiftReqDelete", "id": id], key: "req", done: "必要人数設定を削除しました")
    }

    /// シートで保存したあと（シートが返したことば）
    func done(_ msg: String) {
        toast = NATToast(text: msg)
        Task { await load() }
    }
}

// MARK: - 入口（Web の道 → 画面）

struct NativePhoneShiftsScreen: View {
    let onBack: () -> Void
    let onWeb: (String) -> Void
    @StateObject private var model: NPSHModel

    init(route: NativeModuleRoute, onBack: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.onBack = onBack
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NPSHModel(week: route.query("week")))
    }

    var body: some View {
        NativePhoneShiftsView(model: model, onBack: onBack, onWeb: onWeb)
    }
}

// MARK: - 画面

struct NativePhoneShiftsView: View {
    @ObservedObject var model: NPSHModel
    let onBack: () -> Void
    /// ほかの画面（予算管理など）へ
    let onWeb: (String) -> Void
    @State private var edit: NSHEdit?
    @State private var creating = false
    @State private var addingRequirement = false
    @State private var confirmPublish = false
    @State private var deletingRequirement: NSHRequirement?

    private var today: String { NPDate.str(Date()) }

    var body: some View {
        let p = model.payload
        return NPWPage(
            title: "シフト",
            subtitle: p?.store.name ?? "",
            onBack: onBack,
            trailing: (p?.canManage ?? false) ? NPWBarButton(icon: "plus", label: "追加", action: { creating = true }) : nil,
            loaded: p != nil,
            error: model.error,
            toast: $model.toast,
            retry: { await model.load() },
            header: { header },
            content: { content }
        )
        .task { await model.load() }
        .sheet(item: $edit) { e in
            NSHCellSheet(edit: e, onDone: { msg in
                edit = nil
                model.done(msg)
            }, onClose: { edit = nil })
            .environment(\.colorScheme, .light)
        }
        .sheet(isPresented: $creating) {
            if let p = model.payload {
                NSHCreateSheet(payload: p, onDone: { msg in
                    creating = false
                    model.done(msg)
                }, onClose: { creating = false })
                .environment(\.colorScheme, .light)
            }
        }
        .sheet(isPresented: $addingRequirement) {
            NSHRequirementSheet(onDone: { msg in
                addingRequirement = false
                model.done(msg)
            }, onClose: { addingRequirement = false })
            .environment(\.colorScheme, .light)
        }
        .alert("今週分を公開", isPresented: $confirmPublish) {
            Button("公開する") { Task { await model.publish() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("\(model.payload?.rangeLabel ?? "") の下書きのシフトをまとめて公開します")
        }
        .alert("必要人数設定を削除", isPresented: Binding(get: { deletingRequirement != nil }, set: { if !$0 { deletingRequirement = nil } }), presenting: deletingRequirement) { r in
            Button("削除する", role: .destructive) {
                deletingRequirement = nil
                Task { await model.deleteRequirement(r.id) }
            }
            Button("やめる", role: .cancel) { deletingRequirement = nil }
        } message: { r in
            Text("\(NSHFmt.weekday(r.dayOfWeek))曜日 \(r.timeFrom)〜\(r.timeTo)（\(Int(r.requiredCount))人）")
        }
    }

    // MARK: 上（週の切り替え）

    @ViewBuilder private var header: some View {
        if let p = model.payload {
            let current = p.weekStart == p.todayWeekStart
            NPWPeriodBar(label: p.rangeLabel, sub: current ? "今週" : "", resetLabel: current ? nil : "今週", loading: model.loading,
                         onPrev: { model.move(weeks: -1) },
                         onNext: { model.move(weeks: 1) },
                         onReset: { model.go(p.todayWeekStart) })
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(NT.page)
                .overlay(alignment: .bottom) { Rectangle().fill(NT.line).frame(height: 1) }
        }
    }

    // MARK: 中身

    @ViewBuilder private var content: some View {
        if let p = model.payload {
            if p.canManage { publishCard(p) }
            if !p.shortages.isEmpty { shortageNotice(p) }
            if !p.consecutiveWarnings.isEmpty || !p.weeklyHourWarnings.isEmpty || !p.outOfHoursWarnings.isEmpty { placementNotice(p) }
            if p.staff.isEmpty {
                NPWEmpty(icon: "person.2", title: "この店舗にスタッフが割り当てられていません", message: "スタッフ管理から店舗へ割当を行ってください")
            } else {
                legend
                ForEach(p.weekDates, id: \.date) { d in
                    daySection(p, d)
                }
                laborCard(p)
            }
            if p.canManage { requirementsSection(p) }
        }
    }

    // MARK: 公開（店長系）

    private func publishCard(_ p: NSHPayload) -> some View {
        let drafts = p.shifts.filter { $0.status == "draft" }.count
        let changes = p.shifts.filter { $0.status == "change_requested" }.count
        return NPOCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(drafts > 0 ? "下書き \(drafts)件" : "下書きはありません")
                            .font(.system(size: 16, weight: NT.strong)).foregroundColor(drafts > 0 ? NT.warn : NT.ink)
                        Text("この週のシフト \(p.shifts.count)件").font(.system(size: 12)).foregroundColor(NT.ink3)
                    }
                    Spacer(minLength: 6)
                    NPWButton(text: "今週分を公開", icon: "paperplane.fill", kind: drafts > 0 ? .primary : .secondary, busy: model.busy == "publish") {
                        confirmPublish = true
                    }
                }
                if changes > 0 {
                    Text("変更申請が \(changes)件 あります（シフトを押すと却下・修正できます）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.warn)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // MARK: 注意

    private func shortageNotice(_ p: NSHPayload) -> some View {
        NHXNotice(title: "人員が不足している時間帯があります") {
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(p.shortages.enumerated()), id: \.offset) { _, sh in
                    Text("\(sh.label) \(sh.timeFrom)〜\(sh.timeTo)：必要\(Int(sh.required))人に対し確定シフト\(Int(sh.actual))人")
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func placementNotice(_ p: NSHPayload) -> some View {
        let streaks = p.consecutiveWarnings.map { "\($0.name)さん \(Int($0.streak))連勤" }
        let weekly = p.weeklyHourWarnings.map { "\($0.name)さん \(NSHFmt.hoursMinutes($0.minutes))" }
        let outside = p.outOfHoursWarnings.map { "\($0.name)さん \($0.label) \($0.startTime)〜\($0.endTime)（\($0.reason)）" }
        return NHXNotice(title: "スタッフ配置の注意（保存を妨げるものではありません）") {
            VStack(alignment: .leading, spacing: 8) {
                if !streaks.isEmpty { noticeGroup("連勤（確定シフトが\(Int(p.thresholds.consecutiveDays))日以上連続）", streaks) }
                if !weekly.isEmpty { noticeGroup("週勤務時間超過（当週合計が\(Int(p.thresholds.weeklyHours))時間超）", weekly) }
                if !outside.isEmpty { noticeGroup("営業時間外シフト", outside) }
            }
        }
    }

    private func noticeGroup(_ title: String, _ lines: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.system(size: 13, weight: .bold))
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var legend: some View {
        HStack(spacing: 10) {
            legendItem("仮", NSHStyle.of(NPSHFmt.sample(kind: "planned", status: "published")))
            legendItem("希望", NSHStyle.of(NPSHFmt.sample(kind: "requested", status: "published")))
            legendItem("確定", NSHStyle.of(NPSHFmt.sample(kind: "confirmed", status: "published")))
            legendItem("変更申請中", NSHStyle.of(NPSHFmt.sample(kind: "confirmed", status: "change_requested")))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2).padding(.top, 4)
    }

    private func legendItem(_ text: String, _ st: NSHStyle) -> some View {
        HStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 4, style: .continuous).fill(st.bg)
                .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(st.border, lineWidth: st.width))
                .frame(width: 14, height: 14)
            Text(text).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.ink2).lineLimit(1)
        }
    }

    // MARK: 日ごと

    private func daySection(_ p: NSHPayload, _ d: NSHDay) -> some View {
        let list = p.shifts.filter { $0.date == d.date }.sorted { a, b in
            a.startTime != b.startTime ? a.startTime < b.startTime : a.endTime < b.endTime
        }
        let working = Set(list.map { $0.profileId })
        let isToday = d.date == today
        let off = p.staff.filter { !working.contains($0.id) }
        let selfInStore = p.staff.contains { $0.id == p.selfId }
        let askMine = !p.canManage && selfInStore && !working.contains(p.selfId)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(d.label).font(.system(size: 16, weight: NT.strong)).monospacedDigit().foregroundColor(NPSHFmt.dayColor(d))
                if isToday {
                    Text("今日").font(.system(size: 11, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Capsule().fill(NT.purple))
                }
                Text("\(working.count)人").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink3).monospacedDigit()
                Spacer(minLength: 6)
                if p.canManage {
                    Menu {
                        ForEach(p.staff) { s in
                            Button(s.isHelp ? "\(s.name)（ヘルプ）" : s.name) { open(p, s, d, list.filter { $0.profileId == s.id }) }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "plus").font(.system(size: 12, weight: NT.strong))
                            Text("追加").font(.system(size: 13, weight: NT.strong))
                        }
                        .foregroundColor(NT.purple)
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(Capsule().fill(NT.lilac))
                    }
                    .accessibilityLabel("\(d.label)にシフトを追加")
                }
            }
            .padding(.horizontal, 2)
            VStack(spacing: 0) {
                if list.isEmpty && !askMine {
                    Text("シフトなし").font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14).padding(.vertical, 14)
                }
                ForEach(list) { s in
                    if s.id != list.first?.id { NPWDivider(inset: 14) }
                    shiftRow(p, s, d, list: list)
                }
                if askMine, let me = p.staff.first(where: { $0.id == p.selfId }) {
                    if !list.isEmpty { NPWDivider(inset: 14) }
                    Button { open(p, me, d, []) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "plus.circle").font(.system(size: 16, weight: .bold))
                            Text("この日の希望を出す").font(.system(size: 14.5, weight: NT.strong))
                            Spacer(minLength: 0)
                        }
                        .foregroundColor(NT.purple)
                        .padding(.horizontal, 14).frame(height: 50)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(isToday ? NT.purple.opacity(0.55) : Color.clear, lineWidth: 1.5))
            if p.canManage && !off.isEmpty && !list.isEmpty {
                Text("シフトなし：" + off.map { $0.name }.joined(separator: "・"))
                    .font(.system(size: 11.5)).foregroundColor(NT.ink3).lineLimit(2)
                    .padding(.horizontal, 4)
            }
        }
        .padding(.top, 4)
    }

    private func shiftRow(_ p: NSHPayload, _ s: NSHShift, _ d: NSHDay, list: [NSHShift]) -> some View {
        let st = NSHStyle.of(s)
        let staff = p.staff.first { $0.id == s.profileId } ?? NSHStaff(id: s.profileId, name: "—", isHelp: false)
        let mine = s.profileId == p.selfId
        let tappable = p.canManage || mine
        let others = list.filter { $0.profileId == s.profileId && $0.id != s.id }
        return Button { open(p, staff, d, [s] + others) } label: {
            HStack(spacing: 12) {
                Text("\(s.startTime)\n\(s.endTime)")
                    .font(.system(size: 14, weight: NT.strong)).monospacedDigit().multilineTextAlignment(.center)
                    .foregroundColor(st.fg)
                    .frame(width: 62, height: 48)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(st.bg))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(st.border, lineWidth: st.width))
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(staff.name).font(.system(size: 15.5, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                        if staff.isHelp { NPBadge(text: "ヘルプ", color: NT.purple) }
                        if mine && !p.canManage { NPBadge(text: "自分", color: NT.ink3) }
                    }
                    HStack(spacing: 6) {
                        Text(s.status == "change_requested" ? "変更申請中" : NSHFmt.kindLabel(s.kind))
                            .font(.system(size: 12, weight: .bold)).foregroundColor(st.fg)
                        if s.status == "draft" { Text("下書き").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3) }
                        Text(NPSHFmt.duration(s.startTime, s.endTime)).font(.system(size: 12)).foregroundColor(NT.ink3).monospacedDigit()
                    }
                    if s.status == "change_requested", let note = s.note, !note.isEmpty {
                        Text(note).font(.system(size: 11.5)).foregroundColor(NT.warn).lineLimit(2)
                    }
                }
                Spacer(minLength: 4)
                if tappable {
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!tappable)
    }

    /// シフトを押した（iPad・Web と同じ分け方）
    private func open(_ p: NSHPayload, _ s: NSHStaff, _ d: NSHDay, _ list: [NSHShift]) {
        if p.canManage {
            edit = NSHEdit(mode: .manage, staff: s, day: d, shifts: list)
            return
        }
        guard s.id == p.selfId else { return }
        guard let first = list.first else {
            edit = NSHEdit(mode: .request, staff: s, day: d, shifts: [])
            return
        }
        if first.kind == "requested" {
            edit = NSHEdit(mode: .request, staff: s, day: d, shifts: [first])
            return
        }
        if first.status == "published" {
            edit = NSHEdit(mode: .change, staff: s, day: d, shifts: [first])
            return
        }
        model.toast = NATToast(text: first.status == "change_requested" ? "変更申請中です（店長の確認待ち）" : "このシフトはまだ公開されていません", tone: .warn)
    }

    // MARK: 人件費

    private func laborCard(_ p: NSHPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            NPWSectionTitle(title: "人件費（予定）", count: "合計 \(NSHFmt.yen(p.totalCost))")
            NPOCard {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(p.forecastRows, id: \.date) { r in
                        if r.date != p.forecastRows.first?.date { NPWDivider() }
                        forecastRow(p, r)
                    }
                    NPWDivider().padding(.vertical, 6)
                    Text("スタッフ別").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).padding(.top, 2).padding(.bottom, 4)
                    ForEach(Array(p.laborRows.enumerated()), id: \.offset) { i, r in
                        if i > 0 { NPWDivider() }
                        HStack(spacing: 8) {
                            Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                            if r.isHelp { Text("ヘルプ").font(.system(size: 11, weight: .bold)).foregroundColor(NT.purple) }
                            Spacer(minLength: 4)
                            Text(NSHFmt.hm(r.minutes)).font(.system(size: 13)).monospacedDigit().foregroundColor(NT.ink2)
                            Text(r.cost.map { NSHFmt.yen($0) } ?? "時給未設定")
                                .font(.system(size: r.cost == nil ? 11.5 : 14, weight: .bold)).monospacedDigit()
                                .foregroundColor(r.cost == nil ? NT.ink3 : NT.ink)
                                .frame(minWidth: 76, alignment: .trailing)
                        }
                        .padding(.vertical, 8)
                    }
                    Button { onWeb("/app/budgets") } label: {
                        HStack(spacing: 4) {
                            Text("予算（売上・人件費率）は予算管理で設定できます").font(.system(size: 12, weight: .bold))
                            Image(systemName: "chevron.right").font(.system(size: 10, weight: .bold))
                        }
                        .foregroundColor(NT.purple)
                        .padding(.top, 10)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func forecastRow(_ p: NSHPayload, _ r: NSHForecast) -> some View {
        let over = (r.ratio ?? 0) > p.thresholds.laborRatio
        let plus = (r.diff ?? 0) > 0
        let budget = r.source == "budget"
        return HStack(alignment: .center, spacing: 10) {
            Text(r.label).font(.system(size: 13.5, weight: .bold)).monospacedDigit().foregroundColor(NT.ink).frame(width: 78, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(NSHFmt.yen(r.plannedLabor)).font(.system(size: 14.5, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink)
                Text("\(budget ? "予算" : "過去4週") \(r.salesBasis.map { NSHFmt.yen($0) } ?? "予測不可")")
                    .font(.system(size: 11)).monospacedDigit().foregroundColor(NT.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text(r.ratio.map { NSHFmt.pct($0) } ?? "—").font(.system(size: 14.5, weight: NT.strong)).monospacedDigit()
                    .foregroundColor(over ? NT.danger : NT.ink)
                if let diff = r.diff {
                    Text(NSHFmt.pt(diff)).font(.system(size: 11, weight: .bold)).monospacedDigit().foregroundColor(plus ? NT.danger : NT.ok)
                } else if let t = r.targetRatio {
                    Text("目標 \(NSHFmt.pct(t))").font(.system(size: 11)).foregroundColor(NT.ink3)
                }
            }
        }
        .padding(.vertical, 8)
    }

    // MARK: 時間帯別 必要人数（店長系）

    private func requirementsSection(_ p: NSHPayload) -> some View {
        let rows = p.requirements.sorted { a, b in a.dayOfWeek != b.dayOfWeek ? a.dayOfWeek < b.dayOfWeek : a.timeFrom < b.timeFrom }
        return VStack(alignment: .leading, spacing: 8) {
            NPWSectionTitle(title: "時間帯別 必要人数", count: rows.isEmpty ? "" : "\(rows.count)件") {
                Button { addingRequirement = true } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 12, weight: NT.strong))
                        Text("追加").font(.system(size: 13, weight: NT.strong))
                    }
                    .foregroundColor(NT.purple)
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(Capsule().fill(NT.lilac))
                }
                .buttonStyle(PressableStyle())
            }
            if rows.isEmpty {
                NPWEmpty(icon: "person.3", title: "必要人数の設定がありません", message: "「追加」から曜日・時間帯ごとの必要人数を登録してください")
            } else {
                VStack(spacing: 0) {
                    ForEach(rows) { r in
                        if r.id != rows.first?.id { NPWDivider(inset: 14) }
                        HStack(spacing: 12) {
                            Text("\(NSHFmt.weekday(r.dayOfWeek))曜日").font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                                .frame(width: 58, alignment: .leading)
                            Text("\(r.timeFrom)〜\(r.timeTo)").font(.system(size: 14.5)).monospacedDigit().foregroundColor(NT.ink)
                            Spacer(minLength: 6)
                            Text("\(Int(r.requiredCount))人").font(.system(size: 14.5, weight: NT.strong)).monospacedDigit().foregroundColor(NT.ink)
                            Button { deletingRequirement = r } label: {
                                Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NT.danger)
                                    .frame(width: 44, height: 44)
                            }
                            .buttonStyle(PressableStyle())
                            .disabled(model.busy != nil)
                            .accessibilityLabel("削除")
                        }
                        .padding(.leading, 14).padding(.trailing, 4)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
            }
        }
    }
}

// MARK: - 表示のきまり

enum NPSHFmt {
    /// 凡例の見本のシフト
    static func sample(kind: String, status: String) -> NSHShift {
        NSHShift(id: "", profileId: "", date: "", startTime: "", endTime: "", kind: kind, status: status, note: nil)
    }

    /// 土曜は青・日曜は赤
    static func dayColor(_ d: NSHDay) -> Color {
        if d.label.hasSuffix("(土)") { return NT.purple }
        if d.label.hasSuffix("(日)") { return NT.danger }
        return NT.ink
    }

    /// '10:00'〜'18:30' → '8時間30分'（日をまたぐときは翌日まで）
    static func duration(_ from: String, _ to: String) -> String {
        func minutes(_ s: String) -> Int? {
            let parts = s.split(separator: ":").compactMap { Int($0) }
            guard parts.count >= 2 else { return nil }
            return parts[0] * 60 + parts[1]
        }
        guard let a = minutes(from), let b = minutes(to) else { return "" }
        let m = b >= a ? b - a : b + 24 * 60 - a
        return m % 60 == 0 ? "\(m / 60)時間" : "\(m / 60)時間\(m % 60)分"
    }
}
