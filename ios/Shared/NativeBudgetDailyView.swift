import SwiftUI

// 日別予算登録（ネイティブ）。Web の /app/budgets/daily（DailyBudgetBoard）と同じ（2026-10-24）
//   左：日付・曜日・売上予算（税込）と月合計 ／ 右：テンキー（前日と同じ・C・一括入力・OK）・一時保存・保存する ／ 上：月の切り替え・PDFで出す

struct NBPayload: Codable { let store: NFNamed; let month: String; let values: [String: Int]; let canEdit: Bool }

@MainActor
final class NativeBudgetDailyModel: ObservableObject {
    @Published var payload: NBPayload?
    @Published var month = String(NPDate.str(Date()).prefix(7))
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "budgetDaily"), URLQueryItem(name: "month", value: month)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NBPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    func save(_ values: [String: Int]) async -> Int? {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.floorAct(["type": "budgetDailySave", "month": month, "values": values])
            if !r.ok { error = r.error ?? "保存に失敗しました"; return nil }
            return r.queued ?? 0
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

struct NativeBudgetDailyView: View {
    @ObservedObject var model: NativeBudgetDailyModel
    let onHome: () -> Void
    let onWeb: (String) -> Void

    @State private var values: [String: Int] = [:]
    @State private var active = ""
    @State private var entry = ""
    @State private var loadedMonth = ""

    private let weekdays = ["日", "月", "火", "水", "木", "金", "土"]
    private var days: [String] {
        let parts = model.month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return [] }
        var c = DateComponents(); c.year = parts[0]; c.month = parts[1]; c.day = 1
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        guard let d = cal.date(from: c), let r = cal.range(of: .day, in: .month, for: d) else { return [] }
        return r.map { String(format: "%@-%02d", model.month, $0) }
    }
    private func weekday(_ date: String) -> Int {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        return cal.component(.weekday, from: NPDate.date(date)) - 1
    }
    private var total: Int { values.values.reduce(0, +) }
    private var canEdit: Bool { model.payload?.canEdit ?? false }
    private func draftKey(_ storeId: String) -> String { "tenpo_daily_budget_draft:\(storeId):\(model.month)" }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "日別予算登録", subtitle: "Daily sales budget", onHome: onHome)
            if model.payload != nil {
                VStack(alignment: .leading, spacing: 12) {
                    header
                    HStack(alignment: .top, spacing: 12) {
                        list.frame(maxWidth: .infinity)
                        keypad.frame(width: 320)
                    }
                }
                .padding(16)
            } else {
                Spacer()
                if let e = model.error {
                    VStack(spacing: 10) { Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger); Button("もう一度") { Task { await model.refresh() } } }
                } else { ProgressView("読み込み中…").tint(NFColor.iris) }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task(id: model.month) {
            await model.refresh()
            if let p = model.payload, p.month == model.month, loadedMonth != p.month {
                values = p.values
                active = days.first ?? ""
                entry = ""
                loadedMonth = p.month
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button { onWeb("/app/budgets") } label: {
                HStack(spacing: 3) { Image(systemName: "chevron.left"); Text("予算管理へ戻る") }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
            }.buttonStyle(.plain).padding(.trailing, 8)
            monthBtn("chevron.left") { shift(-1) }
            HStack(spacing: 6) {
                Image(systemName: "calendar")
                Text(model.month.replacingOccurrences(of: "-", with: "年") + "月")
            }
            .font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.navy)
            .padding(.horizontal, 14).frame(height: 40).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
            monthBtn("chevron.right") { shift(1) }
            Text(model.payload?.store.name ?? "").font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2).padding(.leading, 4)
            Spacer()
            Button { exportPdf() } label: {
                HStack(spacing: 6) { Image(systemName: "printer"); Text("PDFで出す"); Text("Print / PDF").font(.system(size: 10, weight: .semibold)).opacity(0.7) }
                    .font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 14).frame(height: 40).background(RoundedRectangle(cornerRadius: 12).fill(NFColor.navy))
            }.buttonStyle(PressableStyle())
        }
    }

    private func monthBtn(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                .frame(width: 44, height: 40).background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        }.buttonStyle(PressableStyle())
    }

    private var list: some View {
        VStack(spacing: 0) {
            HStack {
                Text("日付").frame(width: 72, alignment: .leading); Text("曜日"); Spacer(); Text("売上予算")
            }
            .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink3)
            .padding(.horizontal, 16).frame(height: 36)
            .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(days, id: \.self) { d in dayRow(d).id(d) }
                    }
                }
                .onChange(of: active) { a in withAnimation { proxy.scrollTo(a, anchor: .center) } }
            }
            HStack {
                HStack(spacing: 4) { Text("月合計").font(.system(size: 13, weight: .bold)); Text("MONTH TOTAL").font(.system(size: 10, weight: .semibold)) }.foregroundColor(NFColor.ink3)
                Spacer()
                Text(NT.yen(total)).font(.system(size: 22, weight: .heavy)).monospacedDigit().foregroundColor(NFColor.navy)
            }
            .padding(.horizontal, 16).frame(height: 56)
            .overlay(alignment: .top) { Rectangle().fill(NFColor.navy.opacity(0.1)).frame(height: 2) }
        }
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white))
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func dayRow(_ d: String) -> some View {
        let w = weekday(d)
        let on = d == active
        let v = values[d] ?? 0
        let text = on && !entry.isEmpty ? entry : (v > 0 ? String(v) : "")
        let tone = w == 0 ? NFColor.danger : w == 6 ? NFColor.iris : NFColor.navy
        return Button { select(d) } label: {
            HStack(spacing: 8) {
                Text("\(Int(d.suffix(2)) ?? 0)").font(.system(size: 15, weight: .bold)).foregroundColor(tone).frame(width: 72, alignment: .leading)
                Text(weekdays[w]).font(.system(size: 13, weight: .semibold)).foregroundColor(w == 0 || w == 6 ? tone : NFColor.ink3)
                Spacer()
                Group {
                    if text.isEmpty { Text("未入力").foregroundColor(NFColor.line) } else { Text(NT.yen(Int(text) ?? 0)).foregroundColor(NFColor.navy) }
                }
                .font(.system(size: 17, weight: .bold)).monospacedDigit()
                .frame(minWidth: 132, alignment: .trailing).padding(.horizontal, 12).frame(height: 36)
                .background(RoundedRectangle(cornerRadius: 9).fill(on ? Color.white : Color(hex: 0xF6F6F9)))
                .overlay(RoundedRectangle(cornerRadius: 9).stroke(on ? NFColor.iris : .clear, lineWidth: 2))
            }
            .padding(.horizontal, 16).frame(height: 50)
            .background(on ? NFColor.iris.opacity(0.1) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line.opacity(0.6)).frame(height: 1) }
    }

    private var keypad: some View {
        VStack(spacing: 8) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(active.isEmpty ? "" : "\(Int(active.dropFirst(5).prefix(2)) ?? 0)/\(Int(active.suffix(2)) ?? 0)（\(weekdays[weekday(active)])）").font(.system(size: 11, weight: .semibold)).foregroundColor(.white.opacity(0.7))
                Text(NT.yen(Int(entry) ?? values[active] ?? 0)).font(.system(size: 26, weight: .heavy)).monospacedDigit().foregroundColor(.white)
            }
            .frame(maxWidth: .infinity, alignment: .trailing).padding(.horizontal, 16).padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.navy))
            key(wide: true, bg: NFColor.iris.opacity(0.12), fg: NFColor.iris) { press("same") } label: { HStack(spacing: 4) { Text("前日と同じ"); Text("Same as previous").font(.system(size: 10, weight: .semibold)).opacity(0.7) } }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                key(bg: NFColor.danger.opacity(0.12), fg: NFColor.danger, h: 50) { press("C") } label: { Text("C").font(.system(size: 18, weight: .heavy)) }
                key(bg: Color(hex: 0xF0F0F4), fg: NFColor.navy, h: 50) { fillAll() } label: { HStack(spacing: 3) { Text("一括入力"); Text("Fill month").font(.system(size: 9, weight: .semibold)).opacity(0.6) } }
                key(bg: Color(hex: 0xF0F0F4), fg: NFColor.navy, h: 50) { press("⌫") } label: { Image(systemName: "delete.left") }
                ForEach(["7", "8", "9", "4", "5", "6", "1", "2", "3", "0", "00"], id: \.self) { k in
                    key(bg: Color(hex: 0xF6F6F9), fg: NFColor.navy, h: 58) { press(k) } label: { Text(k).font(.system(size: 20, weight: .heavy)) }
                }
                key(bg: NFColor.navy, fg: .white, h: 58) { press("OK") } label: { Text("OK").font(.system(size: 18, weight: .heavy)) }
            }
            key(wide: true, bg: Color(hex: 0xF0F0F4), fg: NFColor.navy) { saveDraft() } label: { HStack(spacing: 4) { Text("一時保存"); Text("Keep draft").font(.system(size: 10, weight: .semibold)).opacity(0.6) } }
            Button { Task { await save() } } label: {
                HStack(spacing: 8) { Image(systemName: "square.and.arrow.down"); Text(model.busy ? "保存中…" : "保存する") }
                    .font(.system(size: 16, weight: .heavy)).foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 54)
                    .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.navy))
            }
            .buttonStyle(PressableStyle()).disabled(!canEdit || model.busy).opacity(!canEdit || model.busy ? 0.5 : 1)
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 18).fill(Color.white))
    }

    private func key<L: View>(wide: Bool = false, bg: Color, fg: Color, h: CGFloat = 44, action: @escaping () -> Void, @ViewBuilder label: () -> L) -> some View {
        Button(action: action) {
            label().font(.system(size: 14, weight: .bold)).foregroundColor(fg)
                .frame(maxWidth: .infinity).frame(height: h)
                .background(RoundedRectangle(cornerRadius: 12).fill(bg))
        }
        .buttonStyle(PressableStyle())
    }

    // MARK: - 操作（Web の DailyBudgetBoard と同じ）

    private func commit(_ date: String, _ raw: String) {
        if let n = Int(raw), n > 0 { values[date] = n } else { values.removeValue(forKey: date) }
    }

    private func select(_ d: String) {
        if !active.isEmpty && !entry.isEmpty { commit(active, entry) }
        active = d
        entry = ""
    }

    private func press(_ k: String) {
        guard canEdit else { return }
        switch k {
        case "C":
            entry = ""
            values.removeValue(forKey: active)
        case "⌫":
            entry = String(entry.dropLast())
        case "same":
            guard let i = days.firstIndex(of: active), i > 0, let v = values[days[i - 1]] else { return }
            values[active] = v
            entry = ""
            if i + 1 < days.count { active = days[i + 1] }
        case "OK":
            if !entry.isEmpty { commit(active, entry) }
            entry = ""
            if let i = days.firstIndex(of: active), i + 1 < days.count { active = days[i + 1] }
        default:
            var e = entry + k
            while e.count > 1 && e.hasPrefix("0") { e.removeFirst() }
            entry = String(e.prefix(9))
        }
    }

    private func fillAll() {
        guard canEdit else { return }
        let n = Int(entry) ?? values[active] ?? 0
        if n <= 0 { model.error = "先に金額を入れてください"; return }
        var next: [String: Int] = [:]
        for d in days { next[d] = n }
        values = next
        entry = ""
    }

    private func saveDraft() {
        guard let p = model.payload, let data = try? JSONEncoder().encode(values) else { return }
        UserDefaults.standard.set(data, forKey: draftKey(p.store.id))
        model.toast = "一時保存しました（この端末だけ）"
    }

    private func save() async {
        guard canEdit, !model.busy else { return }
        var body = values
        if !entry.isEmpty, let n = Int(entry) { if n > 0 { body[active] = n } else { body.removeValue(forKey: active) } }
        if let t = await model.save(body) {
            values = body
            entry = ""
            if let p = model.payload { UserDefaults.standard.removeObject(forKey: draftKey(p.store.id)) }
            model.toast = "保存しました（\(model.month.replacingOccurrences(of: "-", with: "/")) 合計 \(NT.yen(t))）"
        }
    }

    private func shift(_ n: Int) {
        let parts = model.month.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2 else { return }
        var y = parts[0], m = parts[1] + n
        if m < 1 { m = 12; y -= 1 }
        if m > 12 { m = 1; y += 1 }
        model.month = String(format: "%04d-%02d", y, m)
    }

    private func exportPdf() {
        let sheet = VStack(alignment: .leading, spacing: 0) {
            Text("日別予算登録　\(model.month.replacingOccurrences(of: "-", with: "年"))月　\(model.payload?.store.name ?? "")").font(.system(size: 16, weight: .bold)).padding(.bottom, 10)
            ForEach(days, id: \.self) { d in
                HStack {
                    Text("\(Int(d.suffix(2)) ?? 0)").frame(width: 40, alignment: .leading)
                    Text(weekdays[weekday(d)]).frame(width: 30, alignment: .leading)
                    Spacer()
                    Text(values[d].map { NT.yen($0) } ?? "未入力").monospacedDigit()
                }
                .font(.system(size: 12)).padding(.vertical, 3)
                .overlay(alignment: .bottom) { Rectangle().fill(Color.gray.opacity(0.25)).frame(height: 0.5) }
            }
            HStack { Text("月合計").bold(); Spacer(); Text(NT.yen(total)).bold().monospacedDigit() }.font(.system(size: 14)).padding(.top, 8)
        }
        .padding(28).background(Color.white)
        if let url = NLShare.pdf(of: sheet, width: 560, name: "日別予算_\(model.month).pdf") { NLShare.present(url: url) }
    }
}
