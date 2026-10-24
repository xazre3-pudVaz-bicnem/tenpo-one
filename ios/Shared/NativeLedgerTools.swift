import SwiftUI
import UIKit

// 店舗台帳の上のボタン（Web の components/reservations/ledger-header.tsx の LedgerTop と同じ働き）
//   2026-10-24 Ronnie「ボタンはアイコンの下に文字。外に出すのは 会計・オーダー・その他（…）・｜・予約登録 だけ。あとは その他 の中に」（退店管理 → 会計・オーダー に名前を変更。行き先は同じフロア画面）
//   その他 = CSV出力・集計・PDF作成・空席検索・直接来店・スケジュール・予約リスト・グルメ別・週間・月間カレンダー・ウェイティング・未連絡の予約・顧客台帳・台帳設定

/// 空席検索の結果（サーバー ledgerFindSeats）
struct NLFindSeatsResult: Decodable {
    struct Table: Decodable, Identifiable { let id: String; let name: String; let capacityMin: Int; let capacityMax: Int }
    let ok: Bool
    let error: String?
    let free: [Table]?
    let busyCount: Int?
    let suggestion: String?
}

extension NativeAPI {
    /// 店舗台帳の操作で、戻りの形が違うもの（空席検索）
    func ledgerPost<T: Decodable>(_ body: [String: Any], as type: T.Type) async throws -> T {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await send(req)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Web のページ（CSV など）をそのまま取ってくる（Cookie は Web と同じ）
    func download(_ path: String) async throws -> Data {
        var req = URLRequest(url: AppConfig.url(path))
        req.setValue("1", forHTTPHeaderField: "x-tenpo-app")
        let jar = await cookies()
        if let header = HTTPCookie.requestHeaderFields(with: jar)["Cookie"] {
            req.setValue(header, forHTTPHeaderField: "Cookie")
        }
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
            throw NativeAPIError(message: "取り出せませんでした（\(http.statusCode)）", useWeb: false)
        }
        return data
    }
}

/// 共有シート（CSV・PDF を AirDrop・ファイル・メール・印刷へ）
enum NLShare {
    static func present(url: URL) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }) ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first,
              let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first,
              var top = window.rootViewController else { return }
        while let presented = top.presentedViewController { top = presented }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: 80, width: 1, height: 1)
            pop.permittedArrowDirections = []
        }
        top.present(vc, animated: true)
    }

    static func tempFile(_ name: String, data: Data) -> URL? {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url, options: .atomic); return url } catch { return nil }
    }

    /// SwiftUI の画面を 1 枚の PDF に（Web の「PDF作成」＝ window.print() の代わり）
    @MainActor
    static func pdf<V: View>(of view: V, width: CGFloat, name: String) -> URL? {
        let renderer = ImageRenderer(content: view.frame(width: width))
        renderer.scale = 2
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        var ok = false
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let consumer = CGDataConsumer(url: url as CFURL), let ctx = CGContext(consumer: consumer, mediaBox: &box, nil) else { return }
            ctx.beginPDFPage(nil)
            draw(ctx)
            ctx.endPDFPage()
            ctx.closePDF()
            ok = true
        }
        return ok ? url : nil
    }
}

// MARK: - 上のボタンの列

struct NLToolbar: View {
    @ObservedObject var model: NativeLedgerModel
    let onFloor: () -> Void
    let onWeb: (String) -> Void
    let onNew: () -> Void
    let onFindSeats: () -> Void
    let onWalkIn: () -> Void
    let onPdf: () -> Void
    let onCsv: () -> Void
    /// グルメ連携（ネイティブの設定画面。2026-10-24）
    var onGourmet: () -> Void = {}

    private var p: NLPayload? { model.payload }
    private var date: String { model.date ?? p?.date ?? "" }
    private var month: String { String(date.prefix(7)) }

    var body: some View {
        HStack(spacing: 2) {
            // 右上は「会計・オーダー」（ネイティブのオーダー・会計＝フロア画面へ。2026-10-24 Ronnie「退店管理はいらない、会計・オーダーにして」）
            item("desktopcomputer", "会計・オーダー", action: onFloor)
            Menu {
                Button(action: onCsv) { Label("CSV出力", systemImage: "tablecells") }
                if p?.links?.analytics ?? false { Button { onWeb("/app/reports?from=\(month)-01&to=\(date)") } label: { Label("集計", systemImage: "chart.bar") } }
                Button(action: onPdf) { Label("PDF作成", systemImage: "arrow.down.doc") }
                Divider()
                Button(action: onFindSeats) { Label("空席検索", systemImage: "magnifyingglass") }
                if p?.canWrite ?? false { Button(action: onWalkIn) { Label("直接来店", systemImage: "figure.walk") } }
                Divider()
                Button { model.listMode = false; model.gourmetMode = false; model.weekMode = false; model.monthMode = false; model.waitMode = false } label: { Label("スケジュール", systemImage: "calendar.day.timeline.left") }
                Button { model.listMode = true; model.gourmetMode = false; model.weekMode = false; model.monthMode = false; model.waitMode = false } label: { Label("予約リスト", systemImage: "list.bullet") }
                Button { model.gourmetMode = true; model.weekMode = false; model.monthMode = false; model.waitMode = false } label: { Label("グルメ別", systemImage: "fork.knife") }
                Button { model.weekMode = true; model.monthMode = false; model.waitMode = false } label: { Label("週間", systemImage: "calendar") }
                Button { model.monthMode = true; model.waitMode = false; model.weekMode = false } label: { Label("月間カレンダー", systemImage: "calendar.badge.clock") }
                Button { model.waitMode = true; model.monthMode = false } label: { Label("ウェイティング", systemImage: "person.2.wave.2") }
                Button { model.listMode = true; model.gourmetMode = false; model.weekMode = false; model.monthMode = false; model.waitMode = false; model.pendingOnly = true } label: {
                    let n = p?.unconfirmed ?? p?.summary.unconfirmed ?? 0
                    Label(n > 0 ? "未連絡の予約（\(n)）" : "未連絡の予約", systemImage: "phone.badge.waveform")
                }
                if (p?.links?.customers ?? false) || (p?.links?.settings ?? false) { Divider() }
                if p?.links?.customers ?? false {
                    Button { onWeb("/app/customers") } label: { Label("顧客台帳", systemImage: "person.text.rectangle") }
                }
                if p?.links?.settings ?? false {
                    if !(p?.links?.customers ?? false) { Divider() }
                    Button(action: onGourmet) { Label("グルメ連携", systemImage: "envelope.badge") }
                    Button { onWeb("/app/settings/booking") } label: { Label("台帳設定", systemImage: "gearshape") }
                }
            } label: {
                itemLabel("ellipsis", "その他")
            }
            .accessibilityLabel("その他（CSV・集計・PDF・空席検索・ほかの台帳・設定）")
            if p?.canWrite ?? false {
                // 点線の仕切り → 予約登録
                Path { path in path.move(to: .zero); path.addLine(to: CGPoint(x: 0, y: 44)) }
                    .stroke(NLColor.gray, style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                    .frame(width: 1, height: 44)
                    .padding(.horizontal, 6)
                item("plus", "予約登録", action: onNew)
            }
        }
        .padding(.trailing, 16)
    }

    /// アイコンの下に文字のボタン（塗りなし）
    private func item(_ icon: String, _ ja: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { itemLabel(icon, ja) }
            .buttonStyle(PressableStyle())
    }

    private func itemLabel(_ icon: String, _ ja: String) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 24, weight: .regular)).frame(height: 28)
            Text(ja).font(.system(size: 12, weight: .semibold))
        }
        .foregroundColor(NLColor.navy)
        .frame(width: 88, height: 60)
        .contentShape(Rectangle())
    }
}

// MARK: - 空席検索（Web の FindSeatsDialog と同じ）

private let NL_QUICK_TIMES = ["11:30", "12:00", "13:00", "17:00", "18:00", "19:00", "20:00", "21:00"]
private let NL_STAY_OPTIONS = [60, 90, 120, 150, 180, 240]

struct NLFindSeatsSheet: View {
    @ObservedObject var model: NativeLedgerModel
    let onClose: () -> Void

    @State private var date: Date
    @State private var time = "19:00"
    @State private var partySize = 2
    @State private var stay = 120
    @State private var searching = false
    @State private var result: NLFindSeatsResult?
    @State private var problem: String?

    init(model: NativeLedgerModel, onClose: @escaping () -> Void) {
        self.model = model
        self.onClose = onClose
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        _date = State(initialValue: f.date(from: model.date ?? model.payload?.date ?? "") ?? Date())
    }

    private var dateStr: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        return f.string(from: date)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top, spacing: 18) {
                        NFSection("日付 / Date") {
                            DatePicker("", selection: $date, displayedComponents: [.date]).labelsHidden()
                                .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                        }
                        NFSection("人数 / Guests") { NFStepper(title: nil, value: $partySize, min: 1, max: 999) }
                    }
                    NFSection("時間 / Time") {
                        NFChipGrid(items: NL_QUICK_TIMES.map { ($0, $0, NLColor.blue, false) }, selected: [time], columns: 8, height: 42) { t in time = t; search(t) }
                        HStack(spacing: 8) {
                            Text("ほかの時刻").font(.system(size: 13)).foregroundColor(NLColor.muted)
                            DatePicker("", selection: Binding(get: {
                                let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                                return f.date(from: "\(dateStr) \(time)") ?? Date()
                            }, set: { d in
                                let f = DateFormatter(); f.dateFormat = "HH:mm"; f.timeZone = TimeZone(identifier: "Asia/Tokyo")
                                time = f.string(from: d)
                            }), displayedComponents: [.hourAndMinute]).labelsHidden()
                                .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                        }
                    }
                    NFSection("滞在時間 / Stay") {
                        NFChipGrid(items: NL_STAY_OPTIONS.map { (String($0), $0 % 60 == 0 ? "\($0 / 60)時間" : "\($0 / 60)時間\($0 % 60)分", NLColor.blue, false) }, selected: [String(stay)], columns: 6, height: 42) { v in stay = Int(v) ?? 120 }
                    }
                    Button { search(time) } label: {
                        Text(searching ? "確認中…" : "空席を確認する").font(.system(size: 17, weight: .heavy)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).frame(height: 52)
                            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NLColor.blue))
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                    .disabled(searching)
                    if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red) }
                    if let r = result {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("\(dateStr) \(time)〜（\(stay)分・\(partySize)名）").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.muted)
                            if let s = r.suggestion { Text("おすすめ：\(s)").font(.system(size: 15, weight: .heavy)).foregroundColor(NLColor.navy) }
                            let free = r.free ?? []
                            if free.isEmpty {
                                Text("この時間帯に \(partySize)名が入る空席はありません（使用中 \(r.busyCount ?? 0)卓）").font(.system(size: 14)).foregroundColor(NLColor.ink)
                            } else {
                                Text("空いている卓 \(free.count)（使用中 \(r.busyCount ?? 0)卓）").font(.system(size: 14, weight: .bold)).foregroundColor(NLColor.ink)
                                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                                    ForEach(free) { t in
                                        VStack(spacing: 2) {
                                            Text(t.name).font(.system(size: 16, weight: .heavy)).foregroundColor(NLColor.navy)
                                            Text("\(t.capacityMin)〜\(t.capacityMax)名").font(.system(size: 11)).foregroundColor(NLColor.muted)
                                        }
                                        .frame(maxWidth: .infinity).frame(height: 56)
                                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.greenSoft))
                                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.green.opacity(0.5), lineWidth: 1))
                                    }
                                }
                            }
                        }
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NLColor.line, lineWidth: 1))
                    }
                }
                .padding(20)
            }
            .background(NLColor.page)
            .navigationTitle("空席検索 / Find seats")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
        }
    }

    private func search(_ t: String) {
        searching = true
        problem = nil
        Task {
            defer { searching = false }
            do {
                let r = try await NativeAPI.shared.ledgerPost(["type": "ledgerFindSeats", "date": dateStr, "time": t, "stayMinutes": stay, "partySize": partySize], as: NLFindSeatsResult.self)
                if r.ok { result = r } else { problem = r.error ?? "空席の確認に失敗しました" }
            } catch {
                problem = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            }
        }
    }
}

// MARK: - 直接来店（Web の WalkInDialog と同じ：テーブル・大人・子供・お名前・電話）

struct NLWalkInSheet: View {
    @ObservedObject var model: NativeLedgerModel
    let onClose: () -> Void

    @State private var tableId = ""
    @State private var adults = 2
    @State private var children = 0
    @State private var name = ""
    @State private var phone = ""
    @State private var saving = false
    @State private var problem: String?

    private var tables: [NLTable] { model.payload?.tables ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    NFSection("テーブル / Table") {
                        NFChipGrid(items: tables.map { ($0.id, "\($0.name)（\($0.capacityMax)名）", NLColor.blue, false) }, selected: [tableId], columns: 5, height: 46) { id in tableId = id }
                    }
                    HStack(alignment: .top, spacing: 24) {
                        NFSection("大人 / Adults") { NFStepper(title: nil, value: $adults, min: 0, max: 999) }
                        NFSection("子供 / Children") { NFStepper(title: nil, value: $children, min: 0, max: 999) }
                    }
                    NFSection("お名前 / Name（任意）") {
                        TextField("ウォークイン", text: $name).textFieldStyle(.roundedBorder).font(.system(size: 16))
                    }
                    NFSection("電話番号 / Phone（任意）") {
                        TextField("090-0000-0000", text: $phone).textFieldStyle(.roundedBorder).font(.system(size: 16)).keyboardType(.phonePad)
                    }
                    if let problem { Text(problem).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.red) }
                    Button { Task { await submit() } } label: {
                        VStack(spacing: 1) {
                            Text(saving ? "登録中…" : "登録する").font(.system(size: 18, weight: .heavy))
                            Text("Register walk-in").font(.system(size: 11, weight: .bold)).opacity(0.8)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity).frame(height: 56)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(tableId.isEmpty || adults + children < 1 ? NLColor.blue.opacity(0.4) : NLColor.blue))
                    }
                    .buttonStyle(PressableStyle(scale: 0.98))
                    .disabled(saving || tableId.isEmpty || adults + children < 1)
                }
                .padding(20)
            }
            .background(NLColor.page)
            .navigationTitle("ウォークイン登録 / Walk-in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("キャンセル", action: onClose) } }
        }
    }

    private func submit() async {
        saving = true
        defer { saving = false }
        if let _ = await model.act(["type": "ledgerWalkIn", "tableId": tableId, "adults": adults, "children": children, "name": name, "phone": phone]) {
            model.show(toast: "ウォークインを登録しました")
            onClose()
        } else {
            problem = model.error
        }
    }
}
