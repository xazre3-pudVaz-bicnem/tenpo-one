import SwiftUI

// iPhone の店長・オーナー：給与計算の詳細・自分の給与明細（/app/payroll/<runId>。2026-10-25 Ronnie「iPhone も native に」）
//   店長・オーナー：明細（合計・スタッフ別・計算根拠・日別勤怠）・再計算・確定・承認・下書きに戻す（確定・承認・戻すは必ず確かめてから）・CSV・仕訳へ
//   スタッフ：給与明細書（PDF で保存・印刷）
// サーバーは iPad と同じ GET part=payroll&run=<id> ／ POST payrollRunRecalc・payrollRunConfirm・payrollRunApprove・payrollRunRevert

@MainActor
final class NPPYRunModel: ObservableObject {
    let runId: String
    @Published var payload: NPPYRunPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    init(runId: String) { self.runId = runId }

    func load() async {
        if NativePreview.current != nil { return }
        do {
            payload = try await NPPYApi.get(NPPYRunPayload.self, ["run": runId])
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) } else { toast = NativeModuleAPI.message(error) }
        }
    }

    func act(_ type: String) async {
        guard !busy else { return }
        busy = true
        if NativePreview.current != nil {
            toast = "見本のため保存していません"
            busy = false
            return
        }
        let r = await NPPYApi.post(["type": type, "runId": runId])
        busy = false
        toast = r.ok ? (r.message ?? "できました") : (r.error ?? "できませんでした")
        await load()
    }
}

/// 確定・承認・下書きに戻す の確かめ（Web の ConfirmDialog と同じ文言）
enum NPPYConfirmKind {
    case confirm, approve, revert

    var title: String {
        switch self {
        case .confirm: return "給与計算を確定"
        case .approve: return "給与計算を承認"
        case .revert: return "給与計算を下書きに戻す"
        }
    }

    var message: String {
        switch self {
        case .confirm: return "この内容で確定します。確定後は再計算できません（再計算するには一旦下書きに戻す必要があります）。"
        case .approve: return "承認すると内容を変更できなくなります（金額・計算根拠は以後不変になります）。よろしいですか。"
        case .revert: return "下書きに戻すと再計算が可能になります。勤怠修正申請の承認などで内容が変わった場合はこちらから再計算してください。"
        }
    }

    var button: String {
        switch self {
        case .confirm: return "確定する"
        case .approve: return "承認する"
        case .revert: return "下書きに戻す"
        }
    }

    var type: String {
        switch self {
        case .confirm: return "payrollRunConfirm"
        case .approve: return "payrollRunApprove"
        case .revert: return "payrollRunRevert"
        }
    }
}

struct NPPYRunScreen: View {
    let onBack: () -> Void
    let onWeb: (String) -> Void
    @StateObject private var model: NPPYRunModel

    init(runId: String, onBack: @escaping () -> Void, onWeb: @escaping (String) -> Void) {
        self.onBack = onBack
        self.onWeb = onWeb
        _model = StateObject(wrappedValue: NPPYRunModel(runId: runId))
    }

    var body: some View {
        NPPYRunView(model: model, onBack: onBack, onWeb: onWeb)
    }
}

struct NPPYRunView: View {
    @ObservedObject var model: NPPYRunModel
    let onBack: () -> Void
    let onWeb: (String) -> Void
    @State private var confirm: NPPYConfirmKind?
    @State private var expanded: Set<String> = []
    @State private var exporting = false

    private var title: String {
        guard let p = model.payload else { return "給与" }
        if p.mode == "manage" { return p.run?.title ?? "給与計算" }
        if p.mode == "self" { return p.payslip?.runType == "bonus" ? "賞与明細" : "給与明細" }
        return "給与明細"
    }

    private var subtitle: String {
        guard let p = model.payload else { return "" }
        if p.mode == "manage", let r = p.run { return NPPYFmt.runStatus[r.status] ?? r.status }
        return p.payslip?.runTitle ?? ""
    }

    var body: some View {
        NPOCDetailFrame(title: title, subtitle: subtitle, backLabel: "一覧", onBack: onBack, trailing: {
            barButtons
        }) {
            NPOCBody(loaded: model.payload != nil, error: model.error, retry: { await model.load() }) {
                if let p = model.payload { content(p) }
            }
        }
        .overlay(alignment: .bottom) { NWKToast(toast: $model.toast) }
        .task { await model.load() }
        .alert(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), presenting: confirm) { k in
            Button("キャンセル", role: .cancel) {}
            Button(k.button) { Task { await model.act(k.type) } }
        } message: { k in
            Text(k.message)
        }
    }

    @ViewBuilder private var barButtons: some View {
        if let p = model.payload, p.mode == "manage", let run = p.run {
            Menu {
                Button { exportCsv(run) } label: { Label("CSVで出す", systemImage: "square.and.arrow.up") }
                Button { onWeb("/app/accounting?source_type=payroll&source_id=\(run.id)") } label: { Label("この給与の仕訳を見る", systemImage: "book") }
            } label: {
                Group {
                    if exporting {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "ellipsis.circle").font(.system(size: 19, weight: .bold))
                    }
                }
                .foregroundColor(.white)
                .frame(width: 42, height: 40)
            }
        } else if let p = model.payload, p.mode == "self", let slip = p.payslip {
            NPOCBarButton(icon: "square.and.arrow.up", label: "PDF") { savePdf(slip) }
        }
    }

    @ViewBuilder private func content(_ p: NPPYRunPayload) -> some View {
        if p.mode == "manage", let run = p.run {
            manage(p, run: run)
        } else if p.mode == "self", let slip = p.payslip {
            NPPYPayslipCard(p: slip)
            NPOCWideButton(text: "PDF で保存・印刷", icon: "printer", kind: .secondary, height: 48) { savePdf(slip) }
            NPPYDisclaimer()
        } else {
            NPOCEmpty(icon: "doc.text", title: p.title ?? "この給与明細は表示できません", note: p.message ?? "")
        }
    }

    // MARK: 店長・オーナー

    @ViewBuilder private func manage(_ p: NPPYRunPayload, run: NPPYRunHead) -> some View {
        header(run)
        actions(run)
        if let note = run.note, !note.isEmpty {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "info.circle").font(.system(size: 13, weight: .bold))
                Text(note).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
            }
            .foregroundColor(NT.ink2)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(npocCard(12))
        }
        if run.runType == "bonus" {
            bonusList(p.bonusItems ?? [], total: p.bonusTotal ?? 0)
        } else {
            salaryList(p.items ?? [], totals: p.totals)
        }
        if let s = p.snapshot { NPPYSnapshotCard(s: s) }
        NPPYDisclaimer()
    }

    private func header(_ run: NPPYRunHead) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                NWKBadge(text: NPPYFmt.runType[run.runType] ?? run.runType, color: NPPYFmt.runTypeColor(run.runType))
                NWKBadge(text: NPPYFmt.runStatus[run.status] ?? run.status, color: NPPYFmt.runStatusColor(run.status))
            }
            Text(run.title).font(.system(size: 20, weight: NT.strong)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            Text(run.description).font(.system(size: 13.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            NPPYStatusSteps(status: run.status)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(npocCard())
    }

    /// 承認済みは何もできない（DB でも変えられない）
    @ViewBuilder private func actions(_ run: NPPYRunHead) -> some View {
        if run.status == "draft" {
            VStack(spacing: 8) {
                NPOCWideButton(text: "確定する", icon: "checkmark.circle", kind: .primary, disabled: model.busy) { confirm = .confirm }
                if run.runType == "salary" {
                    NPOCWideButton(text: "再計算（勤怠・ルールから計算し直す）", icon: "arrow.clockwise", kind: .secondary, busy: model.busy, height: 46) {
                        Task { await model.act("payrollRunRecalc") }
                    }
                }
            }
        } else if run.status == "confirmed" {
            VStack(spacing: 8) {
                NPOCWideButton(text: "承認する", icon: "checkmark.shield", kind: .success, disabled: model.busy) { confirm = .approve }
                NPOCWideButton(text: "下書きに戻す", icon: "arrow.uturn.backward", kind: .secondary, disabled: model.busy, height: 46) { confirm = .revert }
            }
        } else if run.status == "approved" {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill").font(.system(size: 13, weight: .bold))
                Text("承認済みのため、内容は変更できません").font(.system(size: 13.5, weight: .semibold))
                Spacer(minLength: 0)
            }
            .foregroundColor(NT.ok)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.ok.opacity(0.09)))
        }
    }

    private func bonusList(_ items: [NPPYBonusItem], total: Double) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("支給額（\(items.count)人）").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            if items.isEmpty {
                Text("支給対象者がいません").font(.system(size: 14)).foregroundColor(NT.ink3)
                    .frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                ForEach(items) { i in
                    Rectangle().fill(NT.line).frame(height: 1).padding(.leading, 14)
                    HStack {
                        Text(i.profileName).font(.system(size: 15.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(NPPYFmt.yen(i.amount)).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    .padding(.horizontal, 14).padding(.vertical, 12)
                }
                HStack {
                    Text("合計").font(.system(size: 15, weight: NT.strong))
                    Spacer()
                    Text(NPPYFmt.yen(total)).font(.system(size: 19, weight: NT.strong)).monospacedDigit()
                }
                .foregroundColor(NT.ink)
                .padding(.horizontal, 14).padding(.vertical, 14)
                .background(NT.lilac)
            }
        }
        .background(npocCard())
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder private func salaryList(_ items: [NPPYItem], totals: NPPYTotals?) -> some View {
        if items.isEmpty {
            NPOCEmpty(icon: "person.2", title: "この期間の対象者がいません", note: "給与ルールが未設定か、勤怠記録がありません")
        } else {
            if let t = totals { totalsCard(t, count: items.count) }
            NPOCSectionTitle(title: "スタッフ別（\(items.count)人）", note: "押すと支給の内訳・計算根拠・日別勤怠が出ます")
            ForEach(items) { item in
                NPPYItemCard(item: item, open: expanded.contains(item.id)) {
                    if expanded.contains(item.id) { expanded.remove(item.id) } else { expanded.insert(item.id) }
                }
            }
        }
    }

    private func totalsCard(_ t: NPPYTotals, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("合計（\(count)人）").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer(minLength: 6)
                Text("総支給").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                Text(NPPYFmt.yen(t.grossTotal)).font(.system(size: 24, weight: NT.strong)).foregroundColor(NT.purpleDeep).monospacedDigit()
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
            NPPYChips(pairs: t.timePairs)
            NPPYChips(pairs: t.payPairs.map { ($0.0, NPPYFmt.yen($0.1)) })
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }

    // MARK: CSV・PDF

    /// CSV（Web の /app/payroll/<id>/export をそのまま取ってきて共有シートへ）
    private func exportCsv(_ run: NPPYRunHead) {
        if NativePreview.current != nil {
            model.toast = "見本のため CSV は出せません"
            return
        }
        exporting = true
        Task {
            do {
                let data = try await NativeAPI.shared.download("/app/payroll/\(run.id)/export")
                let name = NPPYFmt.fileSafe(run.csvName ?? "payroll_\(run.title).csv")
                if let url = NLShare.tempFile(name, data: data) { NLShare.present(url: url) } else { model.toast = "CSV を保存できませんでした" }
            } catch {
                model.toast = NativeModuleAPI.message(error)
            }
            exporting = false
        }
    }

    /// 給与明細を PDF に（Web の「印刷する」の代わり。共有から印刷・保存）
    private func savePdf(_ slip: NPPYPayslip) {
        let kind = slip.runType == "bonus" ? "賞与明細" : "給与明細"
        let name = NPPYFmt.fileSafe("\(kind)_\(slip.runTitle).pdf")
        let page = NPPYPayslipCard(p: slip).padding(20).background(Color.white)
        if let url = NLShare.pdf(of: page, width: 600, name: name) { NLShare.present(url: url) } else { model.toast = "PDF を作れませんでした" }
    }
}

/// 下書き → 確定 → 承認 の今いるところ
struct NPPYStatusSteps: View {
    let status: String

    private var index: Int {
        switch status {
        case "approved": return 2
        case "confirmed": return 1
        default: return 0
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            step(0, "下書き")
            bar(1)
            step(1, "確定")
            bar(2)
            step(2, "承認")
        }
        .padding(.top, 2)
    }

    private func step(_ i: Int, _ label: String) -> some View {
        let done = i <= index
        return HStack(spacing: 5) {
            ZStack {
                Circle().fill(done ? NT.purple : NT.page).frame(width: 22, height: 22)
                if i < index {
                    Image(systemName: "checkmark").font(.system(size: 10, weight: NT.strong)).foregroundColor(.white)
                } else {
                    Text("\(i + 1)").font(.system(size: 11, weight: NT.strong)).foregroundColor(done ? .white : NT.ink3)
                }
            }
            Text(label).font(.system(size: 12.5, weight: i == index ? NT.strong : Font.Weight.semibold)).foregroundColor(done ? NT.ink : NT.ink3)
        }
    }

    private func bar(_ i: Int) -> some View {
        Capsule().fill(i <= index ? NT.purple : NT.line).frame(height: 3).frame(maxWidth: .infinity)
    }
}

/// スタッフ 1 人の明細（押すと支給の内訳・計算根拠・日別勤怠）
struct NPPYItemCard: View {
    let item: NPPYItem
    let open: Bool
    let toggle: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                VStack(alignment: .leading, spacing: 9) {
                    HStack(spacing: 8) {
                        Image(systemName: open ? "chevron.down" : "chevron.right")
                            .font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).frame(width: 14)
                        Text(item.profileName).font(.system(size: 16, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                        Spacer(minLength: 6)
                        Text(NPPYFmt.yen(item.grossTotal)).font(.system(size: 18, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    NPPYChips(pairs: item.timePairs)
                    if item.commissionTotal > 0 {
                        Text("うち歩合給 \(NPPYFmt.yen(item.commissionTotal))").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.purpleDeep)
                    }
                }
                .padding(14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Rectangle().fill(NT.line).frame(height: 1)
                detail
            }
        }
        .background(npocCard())
    }

    private var detail: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 0) {
                Text("支給の内訳").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3).padding(.bottom, 4)
                ForEach(Array(item.payPairs.enumerated()), id: \.offset) { _, pair in
                    HStack {
                        Text(pair.0).font(.system(size: 14)).foregroundColor(NT.ink2)
                        Spacer()
                        Text(NPPYFmt.yen(pair.1)).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    .padding(.vertical, 5)
                }
                Rectangle().fill(NT.line).frame(height: 1).padding(.vertical, 4)
                HStack {
                    Text("総支給").font(.system(size: 14.5, weight: NT.strong))
                    Spacer()
                    Text(NPPYFmt.yen(item.grossTotal)).font(.system(size: 15, weight: NT.strong)).monospacedDigit()
                }
                .foregroundColor(NT.ink)
            }
            if !item.lines.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("計算根拠").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                    ForEach(Array(item.lines.enumerated()), id: \.offset) { _, line in NPPYLineView(line: line) }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("日別勤怠（\(item.days.count)日）").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                if item.days.isEmpty {
                    Text("対象日がありません").font(.system(size: 13)).foregroundColor(NT.ink3)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(item.days.enumerated()), id: \.offset) { i, d in
                            if i > 0 { Rectangle().fill(NT.line).frame(height: 1) }
                            NPPYDayRow(day: d)
                        }
                    }
                    .padding(.horizontal, 10)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(NT.line, lineWidth: 1))
                }
            }
        }
        .padding(14)
        .background(NT.page.opacity(0.6))
    }
}

/// 日別勤怠の 1 行（10/1（水） 10:00〜19:00 実働 8:00。残業・深夜・休日があれば下に）
struct NPPYDayRow: View {
    let day: NPPYDay

    private var extras: String {
        var parts: [String] = []
        if day.overtime != "0:00" && !day.overtime.isEmpty { parts.append("残業 \(day.overtime)") }
        if day.night != "0:00" && !day.night.isEmpty { parts.append("深夜 \(day.night)") }
        if day.holiday != "0:00" && !day.holiday.isEmpty { parts.append("休日 \(day.holiday)") }
        return parts.joined(separator: "・")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Text(NPPYFmt.day(day.date)).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink).frame(width: 82, alignment: .leading)
                Text(day.inOut).font(.system(size: 12.5)).foregroundColor(NT.ink2).monospacedDigit().lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 4)
                Text("実働 \(day.work)").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink).monospacedDigit()
            }
            if !extras.isEmpty {
                Text(extras).font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.warn).padding(.leading, 90)
            }
        }
        .padding(.vertical, 7)
    }
}

/// 計算根拠の 1 行（Web の BreakdownPanel と同じ文言）
struct NPPYLineView: View {
    let line: NPPYLine

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(line.text)
                .font(.system(size: 13.5, weight: line.strong == true ? NT.strong : Font.Weight.regular))
                .foregroundColor(line.strong == true ? NT.ink : NT.ink2)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array((line.sub ?? []).enumerated()), id: \.offset) { _, s in
                Text("・" + s).font(.system(size: 12)).foregroundColor(NT.ink3).padding(.leading, 12).fixedSize(horizontal: false, vertical: true)
            }
            if let tail = line.tail {
                Text(tail).font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).padding(.leading, 12)
            }
        }
    }
}

/// 承認したときに固定したルール（Web の RulesSnapshotPanel。iPhone は表ではなく縦に並べる）
struct NPPYSnapshotCard: View {
    let s: NPPYSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("この計算で使ったルール（承認時点で固定）").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
            if let g = s.generatedLabel { Text(g).font(.system(size: 12)).foregroundColor(NT.ink3) }
            if let note = s.note { Text(note).font(.system(size: 13)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true) }
            if s.payrollRules.isEmpty && s.commissionRules.isEmpty && s.note == nil {
                Text("記録されたルールはありません").font(.system(size: 13)).foregroundColor(NT.ink3)
            }
            ForEach(Array(s.payrollRules.enumerated()), id: \.offset) { _, r in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(r.staff).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                        Spacer()
                        Text("\(r.payType) \(r.base)").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    Text("残業 \(r.overtime)・深夜 \(r.night)・休日 \(r.holiday)・交通費 \(r.commute)").font(.system(size: 12)).foregroundColor(NT.ink2)
                    Text(r.period).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(npocCard(10))
            }
            ForEach(Array(s.commissionRules.enumerated()), id: \.offset) { _, r in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Text(r.name).font(.system(size: 14.5, weight: .bold)).foregroundColor(NT.ink)
                        Spacer()
                        Text(r.value).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                    Text("\(r.target)・\(r.method)").font(.system(size: 12)).foregroundColor(NT.ink2)
                    Text(r.period).font(.system(size: 11.5)).foregroundColor(NT.ink3)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(npocCard(10))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
    }
}

/// 給与明細書（Web の components/payroll/payslip.tsx の iPhone の幅の形）。PDF にもそのまま使う
struct NPPYPayslipCard: View {
    let p: NPPYPayslip

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            head
            totalBox(p.runType == "bonus" ? "賞与支給額" : "差引支給額", p.grossTotal)
            if p.runType != "bonus" {
                // PDF（ImageRenderer）でも出るように Lazy の格子は使わない
                section("勤怠情報") {
                    VStack(spacing: 8) {
                        HStack(spacing: 8) {
                            tile("出勤日数", "\(NPPYFmt.count(p.workDays))日")
                            tile("実働時間", NPPYFmt.minutes(p.workMinutes))
                            tile("残業時間", NPPYFmt.minutes(p.overtimeMinutes))
                        }
                        HStack(spacing: 8) {
                            tile("深夜時間", NPPYFmt.minutes(p.nightMinutes))
                            tile("休日時間", NPPYFmt.minutes(p.holidayMinutes))
                            Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                        }
                    }
                }
                section("支給内訳") {
                    VStack(spacing: 0) {
                        ForEach(Array(p.payPairs.enumerated()), id: \.offset) { _, pair in
                            row(pair.0, pair.1, highlight: pair.0 == "歩合給" && pair.1 > 0)
                        }
                        Rectangle().fill(NT.ink.opacity(0.25)).frame(height: 1.5).padding(.vertical, 2)
                        HStack {
                            Text("支給合計").font(.system(size: 14.5, weight: NT.strong))
                            Spacer()
                            Text(NPPYFmt.yen(p.grossTotal)).font(.system(size: 14.5, weight: NT.strong)).monospacedDigit()
                        }
                        .foregroundColor(NT.ink).padding(.vertical, 8)
                    }
                }
                section("控除") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("税・社会保険料の控除はこれから対応します。いまは 0 円で出しています。")
                            .font(.system(size: 12)).foregroundColor(NT.ink3)
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(NT.page))
                        row("控除合計", 0, highlight: false)
                    }
                }
            }
            Text("本明細は概算の試算です。税金・社会保険料・年末調整は含まれません。正式な計算は社会保険労務士・税理士へご確認ください。")
                .font(.system(size: 10)).foregroundColor(NT.ink3).multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
        }
        .padding(18)
        .background(npocCard())
    }

    private var head: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(p.runType == "bonus" ? "賞与明細書" : "給与明細書").font(.system(size: 19, weight: NT.strong)).foregroundColor(NT.ink)
                Text(p.runTitle).font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
                Text(p.periodLabel).font(.system(size: 12)).foregroundColor(NT.ink3)
            }
            Spacer(minLength: 6)
            VStack(alignment: .trailing, spacing: 3) {
                if let org = p.organizationName { Text(org).font(.system(size: 11.5)).foregroundColor(NT.ink3).multilineTextAlignment(.trailing) }
                Text("\(p.profileName) 様").font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).multilineTextAlignment(.trailing)
            }
        }
    }

    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
            content()
        }
    }

    private func tile(_ label: String, _ value: String) -> some View {
        VStack(spacing: 3) {
            Text(label).font(.system(size: 11)).foregroundColor(NT.ink3)
            Text(value).font(.system(size: 15, weight: .bold)).foregroundColor(NT.ink).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
    }

    private func row(_ label: String, _ value: Double, highlight: Bool) -> some View {
        HStack {
            Text(label).font(.system(size: 14, weight: highlight ? Font.Weight.bold : Font.Weight.regular)).foregroundColor(highlight ? NT.purpleDeep : NT.ink2)
            Spacer()
            Text(NPPYFmt.yen(value)).font(.system(size: 14, weight: highlight ? NT.strong : Font.Weight.regular)).foregroundColor(highlight ? NT.purpleDeep : NT.ink).monospacedDigit()
        }
        .padding(.vertical, 7)
    }

    private func totalBox(_ label: String, _ value: Double) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 14, weight: .semibold))
            Spacer(minLength: 6)
            Text(NPPYFmt.yen(value)).font(.system(size: 28, weight: NT.strong)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.6)
        }
        .foregroundColor(.white)
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.topBar))
    }
}
