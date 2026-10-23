import SwiftUI

// 店舗台帳の「ウェイティング」（ネイティブ）。Web の view=waitlist と同じ（2026-10-24）
//   本日のウェイティング（店頭受付：受付番号・呼出・案内（卓→伝票）・不在・取消・空席の案内候補）
//   キャンセル待ち（満席時の登録：連絡済みにする・予約へ変換・期限切れ・取消）

struct NLWaitTicket: Codable, Identifiable { let id: String; let ticketNo: Int; let guestName: String; let guestPhone: String?; let partySize: Int; let seatPreference: String?; let status: String; let createdAt: String }
struct NLWaitHint: Codable, Hashable { let ticketNo: Int; let guestName: String; let partySize: Int; let label: String }
struct NLWaitEntry: Codable, Identifiable { let id: String; let guestName: String; let guestPhone: String; let partySize: Int; let desiredDate: String; let desiredTimeFrom: String?; let desiredTimeTo: String?; let note: String?; let status: String }
struct NLWaitPayload: Codable {
    let today: String
    let queue: [NLWaitTicket]
    let waitingNow: Int
    let hints: [NLWaitHint]
    let tables: [NFNamedCap]
    let wstatus: String
    let entries: [NLWaitEntry]
}
struct NFNamedCap: Codable, Identifiable, Hashable { let id: String; let name: String; let capacityMax: Int }

private let TICKET_LABEL = ["waiting": "待機中", "called": "呼出中", "seated": "案内済み", "no_show": "不在", "cancelled": "取消"]
private let WAIT_LABEL = ["waiting": "連絡待ち", "contacted": "連絡済み", "converted": "予約済み", "expired": "期限切れ", "cancelled": "取消"]
private let WSTATUS: [(String, String)] = [("waiting", "連絡待ち"), ("contacted", "連絡済み"), ("", "すべて"), ("converted", "予約済み"), ("expired", "期限切れ"), ("cancelled", "取消")]

struct NativeLedgerWaitView: View {
    @ObservedObject var model: NativeLedgerModel
    let onOpenOrder: (String) -> Void

    @State private var payload: NLWaitPayload?
    @State private var wstatus = "waiting"
    @State private var error: String?
    @State private var guideFor: NLWaitTicket?
    @State private var ticketOpen = false
    @State private var waitlistOpen = false
    @State private var convertFor: NLWaitEntry?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let p = payload {
                    queueCard(p)
                    waitlistCard(p)
                } else if let error {
                    Text(error).foregroundColor(NLColor.red).padding(40)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(60)
                }
            }
            .padding(16)
        }
        .task(id: wstatus) { await load() }
        .confirmationDialog("案内する卓を選ぶ", isPresented: Binding(get: { guideFor != nil }, set: { if !$0 { guideFor = nil } }), titleVisibility: .visible) {
            if let g = guideFor {
                ForEach(payload?.tables ?? []) { t in
                    Button("\(t.name)（\(t.capacityMax)名）\(t.capacityMax < g.partySize ? " ⚠︎ 席数不足" : "")") {
                        Task { await guide(g, t.id) }
                    }
                }
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            if let g = guideFor { Text("\(g.guestName) 様（\(g.partySize)名）。案内すると伝票ができて注文の画面が開きます。") }
        }
        .sheet(isPresented: $ticketOpen) { NLWaitTicketSheet(model: model) { ticketOpen = false; Task { await load() } } }
        .sheet(isPresented: $waitlistOpen) { NLWaitlistSheet(model: model, today: payload?.today ?? "") { waitlistOpen = false; Task { await load() } } }
        .sheet(item: $convertFor) { w in
            NativeNewReservationSheet(
                model: model,
                prefill: NLReservationPrefill(waitlistEntryId: w.id, date: w.desiredDate, time: w.desiredTimeFrom.map { String($0.prefix(5)) } ?? "18:00", adults: w.partySize, name: w.guestName, phone: w.guestPhone, note: w.note ?? ""),
                onClose: { convertFor = nil; Task { await load() } }
            )
        }
    }

    private func queueCard(_ p: NLWaitPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("本日のウェイティング").font(.system(size: 17, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("Waiting").font(.system(size: 11)).foregroundColor(NLColor.muted)
                Text("待ち \(p.waitingNow)組").font(.system(size: 13)).foregroundColor(NLColor.muted)
                Spacer()
                actionPill("plus", "受付を登録", fill: NLColor.yellow, ink: NLColor.navy) { ticketOpen = true }
            }
            if !p.hints.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("空席の案内候補").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.green)
                    ForEach(p.hints, id: \.self) { h in
                        Text("#\(h.ticketNo) \(h.guestName) 様　\(h.partySize)名様 → \(h.label)").font(.system(size: 13))
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.greenSoft))
            }
            if p.queue.isEmpty {
                Text("本日の受付はまだありません").font(.system(size: 13)).foregroundColor(NLColor.muted).frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(p.queue) { w in
                        let active = w.status == "waiting" || w.status == "called"
                        HStack(spacing: 12) {
                            Text("#\(w.ticketNo)").font(.system(size: 17, weight: .heavy)).monospacedDigit().foregroundColor(NLColor.blue).frame(width: 52, alignment: .leading)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(w.guestName) 様").font(.system(size: 14, weight: .bold))
                                if let ph = w.guestPhone { Text(ph).font(.system(size: 11)).foregroundColor(NLColor.muted) }
                            }
                            Text("\(w.partySize)名").font(.system(size: 14)).monospacedDigit()
                            if active { Text(elapsed(w.createdAt)).font(.system(size: 12)).foregroundColor(NLColor.muted) }
                            Text(w.seatPreference ?? "—").font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(1)
                            Spacer()
                            Text(TICKET_LABEL[w.status] ?? w.status).font(.system(size: 11, weight: .bold))
                                .foregroundColor(w.status == "called" ? NLColor.navy : w.status == "seated" ? NLColor.green : NLColor.muted)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Capsule().fill(w.status == "called" ? NLColor.yellowSoft : NLColor.graySoft))
                            if w.status == "waiting" { small("呼出", NLColor.blue) { Task { await act(["type": "ledgerWaitCall", "entryId": w.id], "呼び出しました") } } }
                            if active { small("案内", NLColor.green) { guideFor = w } }
                            if active { small("不在", NLColor.muted) { Task { await act(["type": "ledgerWaitNoShow", "entryId": w.id], "不在にしました") } } }
                            if active { small("取消", NLColor.red) { Task { await act(["type": "ledgerWaitCancel", "entryId": w.id], "取消しました") } } }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(w.status == "called" ? NLColor.yellowSoft.opacity(0.5) : Color.clear)
                        .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 12).fill(NLColor.card))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func waitlistCard(_ p: NLWaitPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("キャンセル待ち（満席時の登録）").font(.system(size: 17, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("Waitlist").font(.system(size: 11)).foregroundColor(NLColor.muted)
                Spacer()
                actionPill("plus", "キャンセル待ちを登録", fill: NLColor.navy, ink: .white) { waitlistOpen = true }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(WSTATUS, id: \.0) { k, l in
                        Button { wstatus = k } label: {
                            Text(l).font(.system(size: 13, weight: .semibold)).foregroundColor(wstatus == k ? .white : NLColor.muted)
                                .padding(.horizontal, 14).frame(height: 34)
                                .background(Capsule().fill(wstatus == k ? NLColor.navy : NLColor.card))
                                .overlay(Capsule().stroke(wstatus == k ? Color.clear : NLColor.line, lineWidth: 1))
                        }.buttonStyle(.plain)
                    }
                }
            }
            if p.entries.isEmpty {
                Text("キャンセル待ちはありません").font(.system(size: 13)).foregroundColor(NLColor.muted).frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(p.entries) { w in
                        let actionable = w.status == "waiting" || w.status == "contacted"
                        HStack(spacing: 12) {
                            Text(w.desiredDate.replacingOccurrences(of: "-", with: "/")).font(.system(size: 13, weight: .bold)).monospacedDigit().frame(width: 92, alignment: .leading)
                            Text(timeRange(w)).font(.system(size: 12)).monospacedDigit().foregroundColor(NLColor.muted).frame(width: 96, alignment: .leading)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("\(w.guestName) 様").font(.system(size: 14, weight: .bold))
                                Text(w.guestPhone).font(.system(size: 11)).foregroundColor(NLColor.muted)
                            }
                            Text("\(w.partySize)名").font(.system(size: 14)).monospacedDigit()
                            Text(w.note ?? "—").font(.system(size: 12)).foregroundColor(NLColor.muted).lineLimit(1)
                            Spacer()
                            Text(WAIT_LABEL[w.status] ?? w.status).font(.system(size: 11, weight: .bold)).foregroundColor(NLColor.navy)
                                .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NLColor.graySoft))
                            if w.status == "waiting" { small("連絡済みにする", NLColor.blue) { Task { await act(["type": "ledgerWaitContacted", "entryId": w.id], "連絡済みにしました") } } }
                            if actionable { small("予約へ変換", NLColor.green) { convertFor = w } }
                            if actionable { small("期限切れ", NLColor.muted) { Task { await act(["type": "ledgerWaitExpired", "entryId": w.id], "期限切れにしました") } } }
                            if actionable { small("取消", NLColor.red) { Task { await act(["type": "ledgerWaitCancel", "entryId": w.id], "取消しました") } } }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .overlay(alignment: .bottom) { Rectangle().fill(NLColor.line).frame(height: 1) }
                    }
                }
                .background(RoundedRectangle(cornerRadius: 12).fill(NLColor.card))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
        }
    }

    private func timeRange(_ w: NLWaitEntry) -> String {
        let f = w.desiredTimeFrom.map { String($0.prefix(5)) }
        let t = w.desiredTimeTo.map { String($0.prefix(5)) }
        if f == nil && t == nil { return "指定なし" }
        return "\(f ?? "")〜\(t ?? "")"
    }

    private func elapsed(_ iso: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = f.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        return "\(max(0, Int(Date().timeIntervalSince(d) / 60)))分"
    }

    private func small(_ t: String, _ c: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(t).font(.system(size: 12, weight: .bold)).foregroundColor(c)
                .padding(.horizontal, 10).frame(height: 32)
                .background(RoundedRectangle(cornerRadius: 8).fill(c.opacity(0.1)))
        }.buttonStyle(PressableStyle()).disabled(model.busy)
    }

    private func actionPill(_ icon: String, _ t: String, fill: Color, ink: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { Image(systemName: icon); Text(t) }
                .font(.system(size: 14, weight: .heavy)).foregroundColor(ink)
                .padding(.horizontal, 14).frame(height: 40)
                .background(RoundedRectangle(cornerRadius: 11).fill(fill))
        }.buttonStyle(PressableStyle())
    }

    private func load() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "ledgerWait"), URLQueryItem(name: "wstatus", value: wstatus)]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NLWaitPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    private func act(_ body: [String: Any], _ toast: String) async {
        if await model.act(body) != nil {
            model.show(toast: toast)
            await load()
        }
    }

    private func guide(_ w: NLWaitTicket, _ tableId: String) async {
        if let r = await model.act(["type": "ledgerWaitGuide", "entryId": w.id, "tableId": tableId]) {
            await load()
            if let id = r.orderId { onOpenOrder(id) }
        }
    }
}

// 店頭受付の登録（Web の WaitingTicketDialog：お名前・人数・電話（任意）・希望席（任意））
struct NLWaitTicketSheet: View {
    @ObservedObject var model: NativeLedgerModel
    let onClose: () -> Void
    @State private var name = ""
    @State private var party = 2
    @State private var phone = ""
    @State private var seat = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("お名前") { TextField("山田", text: $name) }
                Section("人数") { Stepper("\(party)名", value: $party, in: 1...999) }
                Section("電話番号（任意）") { TextField("090-0000-0000", text: $phone).keyboardType(.phonePad) }
                Section("希望席（任意）") { TextField("カウンター・テーブル など", text: $seat) }
                if let problem { Section { Text(problem).foregroundColor(NLColor.red) } }
                Section {
                    Button { Task {
                        if let r = await model.act(["type": "ledgerWaitTicket", "name": name, "partySize": party, "phone": phone, "seatPreference": seat]) {
                            model.show(toast: "受付番号 #\(r.queued ?? 0) で登録しました")
                            onClose()
                        } else { problem = model.error; model.error = nil }
                    } } label: { Text("受付する").fontWeight(.heavy).frame(maxWidth: .infinity) }
                    .disabled(model.busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("ウェイティング受付")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }
}

// キャンセル待ちの登録（Web の WaitlistDialog：お名前・電話・人数・希望日・希望時間・メモ）
struct NLWaitlistSheet: View {
    @ObservedObject var model: NativeLedgerModel
    let today: String
    let onClose: () -> Void
    @State private var name = ""
    @State private var phone = ""
    @State private var party = 2
    @State private var date = Date()
    @State private var useTime = false
    @State private var from = Date()
    @State private var to = Date()
    @State private var note = ""
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("お名前・電話番号") {
                    TextField("山田", text: $name)
                    TextField("090-0000-0000", text: $phone).keyboardType(.phonePad)
                }
                Section("人数") { Stepper("\(party)名", value: $party, in: 1...999) }
                Section("希望日・時間") {
                    DatePicker("希望日", selection: $date, displayedComponents: .date)
                    Toggle("時間を指定する", isOn: $useTime)
                    if useTime {
                        DatePicker("から", selection: $from, displayedComponents: .hourAndMinute)
                        DatePicker("まで", selection: $to, displayedComponents: .hourAndMinute)
                    }
                }
                Section("メモ") { TextField("任意", text: $note) }
                if let problem { Section { Text(problem).foregroundColor(NLColor.red) } }
                Section {
                    Button { Task { await save() } } label: { Text("登録する").fontWeight(.heavy).frame(maxWidth: .infinity) }
                        .disabled(model.busy || name.trimmingCharacters(in: .whitespaces).isEmpty || phone.filter(\.isNumber).count < 10)
                }
            }
            .navigationTitle("キャンセル待ちの登録")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }

    private func save() async {
        let d = DateFormatter(); d.dateFormat = "yyyy-MM-dd"; d.timeZone = TimeZone(identifier: "Asia/Tokyo")
        let t = DateFormatter(); t.dateFormat = "HH:mm"; t.timeZone = TimeZone(identifier: "Asia/Tokyo")
        var body: [String: Any] = ["type": "ledgerWaitlistAdd", "name": name, "phone": phone, "partySize": party, "desiredDate": d.string(from: date), "note": note]
        if useTime { body["timeFrom"] = t.string(from: from); body["timeTo"] = t.string(from: to) }
        if await model.act(body) != nil {
            model.show(toast: "キャンセル待ちを登録しました")
            onClose()
        } else { problem = model.error; model.error = nil }
    }
}
