import SwiftUI

// iPhone の店長・オーナー：設定の中の画面（予約・デバイス）。2026-10-25 Ronnie「101% native」
//   予約受付ルール（/app/settings/booking）・予約台帳設定（/app/settings/reservation-book：通知・リマインダー・タグ・グルメ連携・SNS・Google）
//   テーブル・フロア（/app/settings/tables：見る・席数などの変更）・ハンディ端末（/app/settings/handy）・iPhoneハンディ（/app/settings/handy-qr）
// 読み込み・操作は iPad と同じ（NativeBookingSettingsModel・NativeReservationBookModel・NativeTablesModel・NativeHandyDevicesModel）。
// iPhoneハンディの QR の作り直し・お店の Wi-Fi は iPad と同じ GET part=handyQrAdmin ／ POST handyQr…（lib/native-modules/handy-qr.ts。Web と同じ Server Action）

// MARK: - 予約受付ルール

struct NPSBookingPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    var onOpenPage: (NPSPage) -> Void = { _ in }
    @StateObject private var model: NativeBookingSettingsModel
    @State private var form: NBKSettings?
    @State private var pageUrl = ""

    init(backLabel: String = "設定", onBack: @escaping () -> Void, onOpenPage: @escaping (NPSPage) -> Void = { _ in }, model: NativeBookingSettingsModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        self.onOpenPage = onOpenPage
        _model = StateObject(wrappedValue: model ?? NativeBookingSettingsModel())
    }

    var body: some View {
        NPSPageFrame(title: "予約受付ルール", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await load() }) {
            if let p = model.payload {
                NOSErrorBar(error: $model.error)
                if p.adminOnly {
                    NPSIPadCard(title: "管理画面で変更してください", message: p.adminOnlyNote, icon: "lock.shield")
                } else if form != nil {
                    content(p)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        if !NPS.preview { await model.refresh() }
        if let p = model.payload, form == nil { form = p.settings }
    }

    @ViewBuilder private func content(_ p: NBKPayload) -> some View {
        if let u = p.bookingUrl, let url = URL(string: u) {
            NPOCWideButton(text: "公開予約ページを確認", icon: "arrow.up.right.square", kind: .secondary, height: 44) { UIApplication.shared.open(url) }
        }
        if !p.bookingEnabled {
            VStack(alignment: .leading, spacing: 8) {
                Label("この店舗はオンライン予約が停止中です", systemImage: "exclamationmark.triangle.fill").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.warn)
                Text("受付を再開するには「店舗情報」で「オンライン予約」をオンにしてください。").font(.system(size: 12.5)).foregroundColor(NT.ink2)
                Button { onOpenPage(.store) } label: {
                    HStack(spacing: 3) { Text("店舗情報へ"); Image(systemName: "chevron.right") }.font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
                .buttonStyle(.plain)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.warn.opacity(0.1)))
        }
        NPOCard(title: "受付ルール") {
            VStack(alignment: .leading, spacing: 6) {
                Text("予約枠間隔").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).padding(.leading, 4)
                Picker("", selection: Binding(get: { form?.slotMinutes ?? 30 }, set: { form?.slotMinutes = $0 })) {
                    Text("15分").tag(15); Text("30分").tag(30); Text("60分").tag(60)
                }
                .pickerStyle(.segmented)
            }
            HStack(spacing: 8) {
                NPSInput(label: "既定の滞在時間", text: intText(\.defaultStayMinutes), keyboard: .numberPad, suffix: "分")
                NPSInput(label: "受付締切", text: intText(\.bookingCutoffMinutes), keyboard: .numberPad, suffix: "分前")
            }
            HStack(spacing: 8) {
                NPSInput(label: "受付期間", text: intText(\.bookingWindowDays), keyboard: .numberPad, suffix: "日先")
                NPSInput(label: "最大人数", text: intText(\.maxPartySize), keyboard: .numberPad, suffix: "名")
            }
            HStack(spacing: 8) {
                NPSInput(label: "キャンセル期限", text: intText(\.cancelDeadlineHours), keyboard: .numberPad, suffix: "時間前")
                NPSInput(label: "清掃バッファ", text: intText(\.cleaningBufferMinutes), keyboard: .numberPad, suffix: "分")
            }
            Text("清掃バッファ：予約の間に清掃時間を確保します（0〜120分）。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
        }
        NPOCard(title: "公開予約ページの表示内容") {
            VStack(alignment: .leading, spacing: 6) {
                Text("店舗写真").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2).padding(.leading, 4)
                TextField("食べログ・ホットペッパー・お店のホームページの URL", text: $pageUrl)
                    .font(.system(size: 15)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().npocInputBox()
                NPOCWideButton(text: model.importing ? "取り込み中…" : "写真を取り込む", icon: "photo.badge.arrow.down", kind: .secondary, busy: model.importing,
                               disabled: pageUrl.trimmingCharacters(in: .whitespaces).isEmpty, height: 44) { Task { await importPhoto() } }
                Text("貼った URL のページの代表写真を取り込みます。写真の URL（.jpg）を直接貼っても使えます。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                if let f = form, !f.bookingPhotoUrl.isEmpty, let url = URL(string: f.bookingPhotoUrl, relativeTo: AppConfig.url("/")) {
                    HStack(spacing: 10) {
                        AsyncImage(url: url.absoluteURL) { img in img.resizable().scaledToFill() } placeholder: { RoundedRectangle(cornerRadius: 10).fill(NT.lilac) }
                            .frame(width: 120, height: 76).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        Button { form?.bookingPhotoUrl = "" } label: { Text("写真を外す").font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
                            .buttonStyle(.plain)
                        Spacer()
                    }
                }
            }
            NPSInput(label: "ご予約時の注意事項", text: textBinding(\.bookingNotes), placeholder: "例：コースは3日前までのご予約制です。", multiline: true)
            NPSInput(label: "キャンセルポリシー", text: textBinding(\.cancellationPolicy), placeholder: "例：前日以降のキャンセルはご連絡をお願いします。", multiline: true)
            Text("キャンセル料の自動請求は行いません。ポリシーの明示のみ表示します。").font(.system(size: 11.5)).foregroundColor(NT.ink3)
        }
        NPOCard(title: "予約リマインダー") {
            NPSToggleRow(title: "リマインダーを有効にする", isOn: Binding(get: { form?.reminderEnabled ?? false }, set: { form?.reminderEnabled = $0 }))
            NPSInput(label: "送信タイミング（来店何時間前）", text: intText(\.reminderHoursBefore), keyboard: .numberPad, enabled: form?.reminderEnabled ?? false, suffix: "時間前")
            Text("外部メール/SMSプロバイダは未接続です。送信キューに積まれ、実送信は接続後に有効になります。").font(.system(size: 11.5, weight: .semibold)).foregroundColor(NT.warn)
        }
        Text(form == p.settings ? "変更はありません" : "未保存の変更があります").font(.system(size: 12)).foregroundColor(NT.ink3).frame(maxWidth: .infinity)
        NPOCWideButton(text: model.busy ? "保存中…" : "保存する", icon: "square.and.arrow.down", busy: model.busy, disabled: form == p.settings) { Task { await save() } }
    }

    private func intText(_ key: WritableKeyPath<NBKSettings, Int>) -> Binding<String> {
        Binding(get: { form.map { String($0[keyPath: key]) } ?? "" },
                set: { s in form?[keyPath: key] = Int(String(s.filter(\.isNumber).prefix(6))) ?? 0 })
    }

    private func textBinding(_ key: WritableKeyPath<NBKSettings, String>) -> Binding<String> {
        Binding(get: { form?[keyPath: key] ?? "" }, set: { form?[keyPath: key] = $0 })
    }

    private func importPhoto() async {
        let u = pageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty else { return }
        if let photo = await model.importPhoto(pageUrl: u) {
            form?.bookingPhotoUrl = photo
            pageUrl = ""
            model.toast = "写真を取り込みました"
        }
    }

    /// 保存（Web の updateBookingSettings と同じ決まりを先に見る）
    private func save() async {
        guard let f = form, !model.busy else { return }
        if ![15, 30, 60].contains(f.slotMinutes) { model.error = "予約枠間隔の指定が不正です"; return }
        if f.defaultStayMinutes <= 0 || f.bookingWindowDays <= 0 || f.maxPartySize <= 0 { model.error = "数値の指定が正しくありません"; return }
        if f.cleaningBufferMinutes > 120 { model.error = "清掃バッファは0〜120分で指定してください"; return }
        let photo = f.bookingPhotoUrl.trimmingCharacters(in: .whitespaces)
        if !photo.isEmpty && !(photo.hasPrefix("/") && !photo.hasPrefix("//")) && !photo.lowercased().hasPrefix("https://") {
            model.error = "写真URLは「/」で始まるパスか https:// で始まるURLを指定してください"; return
        }
        if NPS.preview { model.toast = "予約設定を保存しました"; return }
        if await model.save(f) {
            model.toast = "予約設定を保存しました"
            await model.refresh()
            if let p = model.payload { form = p.settings }
        }
    }
}

// MARK: - 予約台帳設定

struct NPSReservationBookPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    var onOpenPage: (NPSPage) -> Void = { _ in }
    var onOpenPath: (String) -> Void = { _ in }
    @StateObject private var model: NativeReservationBookModel
    @State private var confirmRegen = false
    @State private var confirmIcal: String?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, onOpenPage: @escaping (NPSPage) -> Void = { _ in }, onOpenPath: @escaping (String) -> Void = { _ in }, model: NativeReservationBookModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        self.onOpenPage = onOpenPage
        self.onOpenPath = onOpenPath
        _model = StateObject(wrappedValue: model ?? NativeReservationBookModel())
    }

    var body: some View {
        NPSPageFrame(title: "予約台帳設定", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                NPZChipRow(items: NativeReservationBookModel.Tab.allCases.map { ($0.rawValue, $0.label) }, selection: model.tab.rawValue) { v in
                    if let t = NativeReservationBookModel.Tab(rawValue: v) { model.tab = t }
                }
                switch model.tab {
                case .book: bookTab(p)
                case .labels: NRWLabelsSettings()
                case .gourmet: gourmetTab(p)
                case .sns: snsTab(p)
                case .google: googleTab(p)
                }
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("取り込み用アドレスを作り直しますか？", isPresented: $confirmRegen, titleVisibility: .visible) {
            Button("作り直す", role: .destructive) { Task { _ = await model.run("regen", ["type": "gourmetMailRegenerate"], done: "アドレスを作り直しました。各サイトに登録し直してください") } }
            Button("やめる", role: .cancel) {}
        } message: { Text("古いアドレスに届いたメールは入らなくなります。各サイトの「設定済」の印も消えます") }
        .confirmationDialog(confirmIcal == "revoke" ? "Google カレンダーへの配信を止めますか？" : "購読URLを作り直しますか？",
                            isPresented: Binding(get: { confirmIcal != nil }, set: { if !$0 { confirmIcal = nil } }), titleVisibility: .visible, presenting: confirmIcal) { kind in
            Button(kind == "revoke" ? "止める" : "作り直す", role: .destructive) {
                Task { _ = await model.run("ical", ["type": kind == "revoke" ? "icalRevoke" : "icalRegenerate"], done: kind == "revoke" ? "配信を止めました" : "購読URLを作り直しました") }
            }
            Button("やめる", role: .cancel) {}
        } message: { kind in
            Text(kind == "revoke" ? "URLが無効になります" : "Google カレンダーに登録した古いURLは止まるので、登録し直しが必要です")
        }
    }

    private func copyBox(_ text: String, label: String) -> some View {
        HStack(spacing: 8) {
            Text(text).font(.system(size: 12, design: .monospaced)).foregroundColor(NT.purpleDeep).lineLimit(2).truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                UIPasteboard.general.string = text
                model.toast = "\(label)をコピーしました"
            } label: {
                Image(systemName: "doc.on.doc").font(.system(size: 14, weight: .bold)).foregroundColor(.white).frame(width: 40, height: 36).background(Capsule().fill(NT.purple))
            }
            .buttonStyle(PressableStyle())
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
    }

    @ViewBuilder private func bookTab(_ p: NRBPayload) -> some View {
        NPOCard(title: "通知を受け取る端末") {
            Text(p.book.pushDevices.isEmpty ? "まだありません。パソコン・iPad・この iPhone でログインすると自動でオンになります（通知の許可が出たら「許可」）"
                 : "\(p.book.pushDevices.count)台：\(p.book.pushDevices.joined(separator: "・"))")
                .font(.system(size: 13.5, weight: .semibold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
        }
        if p.book.reminderEnabled {
            NPOCard(title: "予約リマインダーの準備") {
                Text("設定した「送信タイミング」に入る予約を送信キューへ積みます（1予約1回）").font(.system(size: 12.5)).foregroundColor(NT.ink2)
                NPOCWideButton(text: "リマインダーを準備する", icon: "bell.and.waves.left.and.right", busy: model.busy == "reminder", height: 46) { Task { await model.prepareReminders() } }
                if let r = model.reminderResult { NOMNote(text: r) }
            }
        } else {
            Button { onOpenPage(.booking) } label: {
                HStack(spacing: 6) {
                    Text("お客様へのリマインダーは「予約受付ルール」でオンにできます").font(.system(size: 13, weight: .bold))
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                }
                .foregroundColor(NT.purpleDeep).padding(14).background(npocCard(14))
            }
            .buttonStyle(PressableStyle())
        }
    }

    @ViewBuilder private func gourmetTab(_ p: NRBPayload) -> some View {
        NPOCard(title: "グルメサイトメール取り込み", trailing: p.gourmet.enabled ? "利用中（\(p.gourmet.verifiedCount) サイト設定済）" : "停止中") {
            if !p.gourmet.inboundReady {
                Text("サーバーのメール受信がまだ設定されていません。運営に連絡してください").font(.system(size: 12)).foregroundColor(NT.warn)
            }
            NPSToggleRow(title: "予約メールを自動で台帳へ", sub: p.gourmet.enabled ? "食べログ・ホットペッパー等の予約メールを取り込みます" : "オンにすると取り込み専用アドレスが出ます",
                         isOn: Binding(get: { p.gourmet.enabled }, set: { v in
                             Task { _ = await model.run("enabled", ["type": "gourmetMailEnabled", "enabled": v], done: v ? "取り込みを始めました" : "取り込みを止めました") }
                         }), disabled: !p.canEdit || model.busy != nil)
            if p.gourmet.enabled, let addr = p.gourmet.address {
                Text("取り込み専用メールアドレス").font(.system(size: 12, weight: .bold)).foregroundColor(NT.ink3)
                copyBox(addr, label: "アドレス")
                if p.gourmet.canRegenerate {
                    NPOCWideButton(text: "アドレスを作り直す", icon: "arrow.clockwise", kind: .secondary, busy: model.busy == "regen", height: 40) { confirmRegen = true }
                }
            }
        }
        if p.gourmet.enabled {
            NPOCSectionTitle(title: "サイトごとの設定")
            ForEach(p.gourmet.sites) { site in siteCard(p, site) }
        }
        NPOCSectionTitle(title: "取り込んだメール", note: "最近 50 件")
        if p.gourmet.imports.isEmpty { NPOCEmpty(icon: "envelope", title: "まだ取り込んだメールはありません") }
        ForEach(p.gourmet.imports) { r in importCard(p, r) }
    }

    private func siteCard(_ p: NRBPayload, _ site: NRBSite) -> some View {
        let open = model.openSite?.key == site.key
        return VStack(alignment: .leading, spacing: 8) {
            Button { model.openSite = open ? nil : site } label: {
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(site.name).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                        Text("最新：\(site.lastImportLabel ?? "----/--/-- --:--")\(site.lastKindLabel.map { "（\($0)）" } ?? "")").font(.system(size: 11)).foregroundColor(NT.ink3)
                    }
                    Spacer(minLength: 4)
                    if site.status == "verified" { NOSBadge(text: "設定済", color: NT.ok) }
                    else if site.status == "registered" { NOSBadge(text: "メール待ち", color: NT.warn) }
                    else { NOSBadge(text: "未設定", color: NT.ink3) }
                    Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                if let addr = p.gourmet.address {
                    Text("1. 取り込み専用アドレスをコピー").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                    copyBox(addr, label: "アドレス")
                }
                Text("2. \(site.name) の店舗管理画面で、予約通知メールの送り先に登録").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                Text(site.howTo).font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                if let u = site.adminUrl, let url = URL(string: u) {
                    Link(destination: url) { Label("\(site.name) の管理画面を開く", systemImage: "arrow.up.right.square").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep) }
                }
                Text("3. 登録できたら印を付ける（最初のメールが届くと「設定済」に変わります）").font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink)
                if site.status == "off" {
                    NPOCWideButton(text: "登録した", icon: "checkmark", busy: model.busy == "site" + site.key, disabled: !p.canEdit, height: 44) {
                        Task { _ = await model.run("site" + site.key, ["type": "gourmetSiteRegistered", "site": site.key, "registered": true], done: "印を付けました") }
                    }
                } else {
                    NPOCWideButton(text: "印を外す", kind: .secondary, busy: model.busy == "site" + site.key, disabled: !p.canEdit, height: 44) {
                        Task { _ = await model.run("site" + site.key, ["type": "gourmetSiteRegistered", "site": site.key, "registered": false], done: "印を外しました") }
                    }
                }
                if let s = site.setupLabel { Text("設定：\(s)").font(.system(size: 11.5)).foregroundColor(NT.ink3) }
            }
        }
        .padding(12).background(npocCard(14))
    }

    private func importCard(_ p: NRBPayload, _ r: NRBImport) -> some View {
        let review = r.status == "needs_review" && !r.resolved
        let open = model.openImport == r.id
        return VStack(alignment: .leading, spacing: 6) {
            Button { model.openImport = open ? nil : r.id } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(r.siteName).font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ink).lineLimit(1)
                        Text(r.kindLabel).font(.system(size: 12)).foregroundColor(NT.ink2)
                        Spacer(minLength: 4)
                        NOSBadge(text: r.resolved ? "対応済み" : r.statusLabel, color: review ? NT.danger : (r.resolved ? NT.ink3 : (r.status == "imported" || r.status == "updated" ? NT.ok : NT.ink2)))
                    }
                    HStack(spacing: 6) {
                        Text(r.receivedLabel).font(.system(size: 11)).foregroundColor(NT.ink3).monospacedDigit()
                        Text(r.summary).font(.system(size: 12.5)).foregroundColor(NT.ink2).lineLimit(1)
                        Spacer(minLength: 0)
                        if r.kind == "verify" && !r.links.isEmpty && !r.resolved { NPSTag(text: "要クリック", color: NT.warn) }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                Text("件名：\(r.subject ?? "—")").font(.system(size: 12)).foregroundColor(NT.ink2)
                Text("差出人：\(r.fromAddress ?? "—")").font(.system(size: 12)).foregroundColor(NT.ink2)
                if let e = r.externalId { Text("予約番号：\(e)").font(.system(size: 12)).foregroundColor(NT.ink2) }
                if let err = r.error { Text("理由：\(err)").font(.system(size: 12, weight: .bold)).foregroundColor(NT.danger) }
                if let body = r.bodyText, !body.isEmpty {
                    ScrollView { Text(body).font(.system(size: 11.5)).foregroundColor(NT.ink2).frame(maxWidth: .infinity, alignment: .leading).padding(8) }
                        .frame(maxHeight: 200).background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NT.page))
                }
                if r.kind == "verify" {
                    ForEach(r.links, id: \.self) { u in
                        if let url = URL(string: u) {
                            Link(destination: url) { Label("認証リンクを開く", systemImage: "link").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep) }
                        }
                    }
                }
                HStack(spacing: 8) {
                    if let rid = r.reservationId {
                        NPOCWideButton(text: "台帳で開く", icon: "calendar", kind: .secondary, height: 42) { onOpenPath("/app/reservations?open=\(rid)") }
                    }
                    if review && p.canEdit {
                        NPOCWideButton(text: "対応済みにする", icon: "checkmark", busy: model.busy == "imp" + r.id, height: 42) {
                            Task { _ = await model.run("imp" + r.id, ["type": "gourmetImportResolve", "importId": r.id], done: "対応済みにしました") }
                        }
                    }
                }
            }
        }
        .padding(12).background(npocCard(14))
    }

    private func channelCard(_ c: NRBChannel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                if let img = NPS.qrImage(c.link, scale: 8) {
                    Image(uiImage: img).interpolation(.none).resizable().frame(width: 76, height: 76)
                        .padding(4).background(RoundedRectangle(cornerRadius: 8).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 8).stroke(NT.line, lineWidth: 1))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.label).font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                    Text("過去30日の予約 \(c.count30d) 件").font(.system(size: 11.5)).foregroundColor(NT.ink3)
                    Text(c.howTo).font(.system(size: 12)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                }
            }
            copyBox(c.link, label: "\(c.label) の予約リンク")
            if let u = c.adminUrl, let url = URL(string: u) {
                Link(destination: url) { Label("\(c.label) を開く", systemImage: "arrow.up.right.square").font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep) }
            }
        }
        .padding(12).background(npocCard(14))
    }

    @ViewBuilder private func snsTab(_ p: NRBPayload) -> some View {
        if p.links.bookingUrl == nil {
            NOMNote(text: "公開予約URLを出すには、環境変数 NEXT_PUBLIC_SITE_URL と店舗のスラッグが必要です")
        } else {
            NPOCSectionTitle(title: "SNS に貼る予約リンク", note: "リンクから入った予約は経路にそのSNSが付きます")
            ForEach(p.links.channels.filter { !$0.google }) { c in channelCard(c) }
        }
        NPOCard(title: "お店の SNS アカウント") {
            NPSInput(label: "Instagram", text: $model.sns.instagram, placeholder: "https://www.instagram.com/…", keyboard: .URL, enabled: p.canEdit)
            NPSInput(label: "LINE公式", text: $model.sns.line, placeholder: "https://lin.ee/…", keyboard: .URL, enabled: p.canEdit)
            NPSInput(label: "Facebook", text: $model.sns.facebook, placeholder: "https://www.facebook.com/…", keyboard: .URL, enabled: p.canEdit)
            NPSInput(label: "X（Twitter）", text: $model.sns.x, placeholder: "https://x.com/…", keyboard: .URL, enabled: p.canEdit)
            if p.canEdit {
                NPOCWideButton(text: "保存する", icon: "square.and.arrow.down", busy: model.busy == "sns", disabled: !model.snsDirty, height: 46) { Task { await model.saveSns() } }
            }
        }
    }

    @ViewBuilder private func googleTab(_ p: NRBPayload) -> some View {
        if p.links.bookingUrl == nil {
            NOMNote(text: "公開予約URLを出すには、環境変数 NEXT_PUBLIC_SITE_URL と店舗のスラッグが必要です")
        } else {
            NPOCSectionTitle(title: "Google の「予約」ボタン", note: "Google ビジネスプロフィール")
            ForEach(p.links.channels.filter(\.google)) { c in channelCard(c) }
        }
        NPOCard(title: "Google カレンダーに予約を出す") {
            Text("Google カレンダー →「他のカレンダー」→「URL で追加」に購読URLを入れると、台帳の予約が自動で出ます（15分ごとに更新）")
                .font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            if let feed = p.links.icalFeedUrl {
                copyBox(feed, label: "購読URL")
                if p.canEdit {
                    HStack(spacing: 8) {
                        NPOCWideButton(text: "作り直す", icon: "arrow.clockwise", kind: .secondary, busy: model.busy == "ical", height: 42) { confirmIcal = "regen" }
                        NPOCWideButton(text: "配信を止める", icon: "xmark.circle", kind: .secondary, busy: model.busy == "ical", height: 42) { confirmIcal = "revoke" }
                    }
                }
                Text("このURLを知っている人は予約が見られます。外に出さないでください").font(.system(size: 11.5)).foregroundColor(NT.ink3)
            } else {
                NPOCWideButton(text: "購読URLを作る", icon: "calendar.badge.plus", busy: model.busy == "ical", disabled: !p.canEdit, height: 46) {
                    Task { _ = await model.run("ical", ["type": "icalRegenerate"], done: "購読URLを作りました") }
                }
            }
        }
    }
}

// MARK: - テーブル・フロア

struct NPSTablesPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    var onOpenPage: (NPSPage) -> Void = { _ in }
    @StateObject private var model = NativeTablesModel()
    @State private var confirmDelete: NTBTable?

    private var editingId: String? {
        if case .editTable(let id) = model.panel { return id }
        return nil
    }

    var body: some View {
        NPSPageFrame(title: "テーブル・フロア", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }, trailing: {
            if model.payload?.canEdit == true { NPOCBarButton(icon: "plus", label: "卓") { model.startAdd() } }
        }) {
            if let p = model.payload {
                if !p.canEdit { NPSLockNote(text: p.adminOnlyNote) }
                NPZChipRow(items: [("", "すべて（\(p.tables.count)卓）")] + p.floors.map { ($0.id, "\($0.name)（\($0.tableCount)）") },
                           selection: model.floorFilter ?? "") { v in model.floorFilter = v.isEmpty ? nil : v }
                if model.tables.isEmpty { NPOCEmpty(icon: "rectangle.split.3x3", title: "テーブルがありません") }
                ForEach(model.tables) { t in row(t, p) }
                Button { onOpenPage(.tableQr) } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "qrcode").font(.system(size: 14, weight: .bold))
                        Text("テーブルQRコード（A4 の印刷）").font(.system(size: 14, weight: .bold))
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold))
                    }
                    .foregroundColor(NT.purpleDeep).padding(.horizontal, 14).frame(height: 48).background(npocCard(14))
                }
                .buttonStyle(PressableStyle())
                NOMNote(text: "フロアの追加・名前の変更・配置（レイアウト）は、画面の広い iPad・PC で行ってください。")
            }
        }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("テーブルを削除しますか？", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible, presenting: confirmDelete) { t in
            Button("削除する", role: .destructive) { Task { _ = await model.run("del" + t.id, ["type": "tableDelete", "id": t.id], done: "削除しました") } }
            Button("やめる", role: .cancel) {}
        } message: { t in Text("「\(t.name)」を削除します。過去の伝票は残ります") }
        .sheet(isPresented: Binding(get: { model.panel == .addTable || editingId != nil }, set: { if !$0 { model.panel = .none } })) {
            if let p = model.payload {
                NPOCSheetFrame(title: editingId == nil ? "テーブルを追加" : "テーブルを編集", confirmText: "保存", busy: model.busy == "table",
                               onCancel: { model.panel = .none }, onConfirm: {
                                   if model.tName.trimmingCharacters(in: .whitespaces).isEmpty { model.toast = "テーブル名を入力してください"; return }
                                   Task { await model.saveTable(id: editingId) }
                               }) {
                    NPSInput(label: "テーブル名", text: $model.tName, placeholder: "例：T1・カウンター1", required: true)
                    if !p.floors.isEmpty {
                        NPOCField(label: "フロア") { NPSChoice(options: p.floors.map { ($0.id, $0.name) }, selection: model.tFloor ?? "") { model.tFloor = $0 } }
                    }
                    HStack(spacing: 8) {
                        NPSInput(label: "最小", text: $model.tMin, placeholder: "2", keyboard: .numberPad, suffix: "名")
                        NPSInput(label: "最大", text: $model.tMax, placeholder: "4", keyboard: .numberPad, suffix: "名")
                    }
                    VStack(spacing: 4) {
                        NPSToggleRow(title: "個室", isOn: $model.tPrivate)
                        NPSToggleRow(title: "カウンター", isOn: $model.tCounter)
                        NPSToggleRow(title: "喫煙可", isOn: $model.tSmoking)
                    }
                    .padding(12).background(npocCard(14))
                    NPSInput(label: "並び順", text: $model.tSort, placeholder: "0", keyboard: .numberPad)
                    if let t = model.toast { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NT.danger) }
                }
                .presentationDetents([.large])
            }
        }
    }

    private func row(_ t: NTBTable, _ p: NTBPayload) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(t.name).font(.system(size: 16, weight: NT.strong)).foregroundColor(t.available ? NT.ink : NT.ink3)
                    if !t.available { NPSTag(text: "利用停止", color: NT.danger) }
                }
                HStack(spacing: 5) {
                    Text("\(t.capacityMin)〜\(t.capacityMax)名").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                    if let f = t.floorName { Text(f).font(.system(size: 11.5)).foregroundColor(NT.ink3) }
                    if t.isPrivateRoom { NPSTag(text: "個室") }
                    if t.isCounter { NPSTag(text: "カウンター") }
                    if t.smokingAllowed { NPSTag(text: "喫煙可") }
                }
            }
            Spacer(minLength: 4)
            if p.canEdit {
                Menu {
                    Button { model.startEdit(t) } label: { Label("編集", systemImage: "pencil") }
                    Button(role: .destructive) { confirmDelete = t } label: { Label("削除", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 20, weight: .semibold)).foregroundColor(NT.ink2).frame(width: 38, height: 38)
                }
            }
        }
        .padding(12).background(npocCard(14))
    }
}

// MARK: - ハンディ端末（スマホを QR でハンディとして登録・解除）

struct NPSHandyDevicesPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NativeHandyDevicesModel
    @State private var now = Date()
    @State private var confirmRevoke: NHVDevice?
    @State private var renaming: NHVDevice?
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NativeHandyDevicesModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeHandyDevicesModel())
    }

    var body: some View {
        NPSPageFrame(title: "ハンディ端末", backLabel: backLabel, loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if p.canEdit { pairCard(p) }
                NPOCSectionTitle(title: "登録済みの端末", note: "\(p.devices.filter { $0.status != "revoked" }.count)台")
                if p.devices.isEmpty { NPOCEmpty(icon: "iphone", title: "まだ端末がありません") }
                ForEach(p.devices) { d in row(d, p) }
            }
        }
        .onReceive(tick) { now = $0 }
        .task { if !NPS.preview { await model.refresh() } }
        .confirmationDialog("ハンディを解除しますか？", isPresented: Binding(get: { confirmRevoke != nil }, set: { if !$0 { confirmRevoke = nil } }), titleVisibility: .visible, presenting: confirmRevoke) { d in
            Button("解除する", role: .destructive) { Task { await model.revoke(d) } }
            Button("やめる", role: .cancel) {}
        } message: { d in Text("「\(d.name)」はハンディとして使えなくなります") }
        .alert("端末の名前", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("端末の名前", text: $model.editName)
            Button("決定") { if let d = renaming { Task { await model.rename(d) } }; renaming = nil }
            Button("やめる", role: .cancel) { renaming = nil }
        }
    }

    private func pairCard(_ p: NHVPayload) -> some View {
        NPOCard(title: "スマホをハンディとして登録") {
            TextField("端末の名前（例：ホール1・田中のiPhone）", text: $model.deviceName).font(.system(size: 15)).npocInputBox()
            NPOCWideButton(text: "QRコードを表示", icon: "qrcode", busy: model.busy == "issue", disabled: p.pairBase == nil, height: 46) { Task { await model.issue() } }
            if p.pairBase == nil {
                Text("公開URL（NEXT_PUBLIC_SITE_URL）が未設定のため、QRコードを作れません").font(.system(size: 12)).foregroundColor(NT.danger)
            }
            if let q = model.qr {
                let left = max(0, Int(q.expiresAt.timeIntervalSince(now)))
                if left > 0 {
                    VStack(spacing: 8) {
                        if let img = NPS.qrImage(q.url, scale: 12) {
                            Image(uiImage: img).interpolation(.none).resizable().scaledToFit().frame(width: 220, height: 220)
                                .padding(10).background(RoundedRectangle(cornerRadius: 12).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NT.line, lineWidth: 1))
                        }
                        Text("登録するスマホのカメラでこの QR を読んでください").font(.system(size: 13.5, weight: .bold)).foregroundColor(NT.ink).multilineTextAlignment(.center)
                        Text("あと \(left / 60):\(String(format: "%02d", left % 60))").font(.system(size: 22, weight: NT.strong)).foregroundColor(NT.purple).monospacedDigit()
                        NPOCWideButton(text: "一覧を読み直す", icon: "arrow.clockwise", kind: .secondary, height: 40) { Task { await model.refresh() } }
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("QR の有効期限が切れました。もう一度「QRコードを表示」を押してください").font(.system(size: 12.5)).foregroundColor(NT.ink3)
                }
            }
        }
    }

    private func row(_ d: NHVDevice, _ p: NHVPayload) -> some View {
        let revoked = d.status == "revoked"
        let online = !revoked && Self.isOnline(d.lastSeenAt, now: now)
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "iphone").font(.system(size: 15, weight: .semibold)).foregroundColor(revoked ? NT.ink3 : NT.purple)
                .frame(width: 34, height: 34).background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(revoked ? NT.page : NT.lilac))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(d.name).font(.system(size: 15, weight: NT.strong)).foregroundColor(revoked ? NT.ink3 : NT.ink).strikethrough(revoked, color: NT.ink3).lineLimit(1)
                    if revoked { NPSTag(text: "解除済み") }
                }
                if !revoked {
                    HStack(spacing: 5) {
                        Circle().fill(online ? NT.ok : NT.ink3.opacity(0.5)).frame(width: 7, height: 7)
                        Text(online ? "使用中" : "未使用").font(.system(size: 11.5, weight: .bold)).foregroundColor(online ? NT.ok : NT.ink3)
                    }
                }
                Text("登録 \(NPS.mdhm(d.pairedAt))・最後に使った \(NPS.mdhm(d.lastSeenAt))").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
            }
            Spacer(minLength: 4)
            if model.busy == d.id { ProgressView() }
            if p.canEdit && !revoked {
                Menu {
                    Button { model.editName = d.name; renaming = d } label: { Label("名前を変える", systemImage: "pencil") }
                    Button(role: .destructive) { confirmRevoke = d } label: { Label("解除する", systemImage: "xmark.circle") }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.system(size: 20, weight: .semibold)).foregroundColor(NT.ink2).frame(width: 38, height: 38)
                }
            }
        }
        .padding(12).background(npocCard(14))
    }

    /// 3分以内に通信していれば「使用中」
    static func isOnline(_ iso: String?, now: Date) -> Bool {
        guard let d = NPOCFmt.date(iso) else { return false }
        return now.timeIntervalSince(d) < 180
    }
}

// MARK: - iPhoneハンディ（お店に 1 つの固定 QR・お店の Wi-Fi）

struct NPSHandyQrInfo: Decodable {
    struct Network: Decodable, Identifiable, Hashable { let key: String; let label: String; let addedAt: String; var id: String { key } }
    let store: NFNamed
    let url: String?
    let wifiOnly: Bool
    let activeDevices: Int
    let networks: [Network]
    let currentNetwork: String?
    let currentIsShop: Bool
    /// 登録できる回線の数（iPad の設定 › iPhoneハンディ と同じ返事）
    let maxNetworks: Int?
}

@MainActor
final class NPSHandyQrModel: ObservableObject {
    @Published var payload: NPSHandyQrInfo?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy: String?
    @Published var networkLabel = ""

    init() { payload = NativeModuleAPI.cached(NPSHandyQrInfo.self, part: "handyQrAdmin") }

    func refresh() async {
        if NPS.preview { return }
        do {
            payload = try await NativeModuleAPI.get(NPSHandyQrInfo.self, part: "handyQrAdmin")
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) }
        }
    }

    /// 操作して読み直す（Web の 設定 › iPhoneハンディ と同じ Server Action）
    func run(_ key: String, _ body: [String: Any], done: String) async {
        guard busy == nil else { return }
        busy = key
        defer { busy = nil }
        let r = await NPZApi.post(body)
        guard r.ok else { toast = r.error ?? "うまくいきませんでした"; return }
        await refresh()
        toast = done
    }
}

struct NPSHandyQrPage: View {
    var backLabel = "設定"
    let onBack: () -> Void
    @StateObject private var model: NPSHandyQrModel
    @State private var confirmRegen = false
    @State private var confirmRemove: NPSHandyQrInfo.Network?

    init(backLabel: String = "設定", onBack: @escaping () -> Void, model: NPSHandyQrModel? = nil) {
        self.backLabel = backLabel
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NPSHandyQrModel())
    }

    var body: some View {
        NPSPageFrame(title: "iPhoneハンディ", subtitle: model.payload?.store.name ?? "", backLabel: backLabel, loaded: model.payload != nil, error: model.error,
                     toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload { content(p) }
        }
        .task { await model.refresh() }
        .confirmationDialog("QRコードを作り直しますか？", isPresented: $confirmRegen, titleVisibility: .visible) {
            Button("作り直す", role: .destructive) { Task { await model.run("regen", ["type": "handyQrRegenerate"], done: "QRコードを作り直しました。新しい QR を貼り直してください") } }
            Button("やめる", role: .cancel) {}
        } message: { Text("古い QR では開けなくなり、今ログインしているハンディもすべてログアウトします") }
        .confirmationDialog("この回線を外しますか？", isPresented: Binding(get: { confirmRemove != nil }, set: { if !$0 { confirmRemove = nil } }), titleVisibility: .visible, presenting: confirmRemove) { n in
            Button("外す", role: .destructive) { Task { await model.run("net" + n.key, ["type": "handyQrNetworkRemove", "key": n.key], done: "回線を外しました") } }
            Button("やめる", role: .cancel) {}
        } message: { n in Text("「\(n.label)」をお店の Wi-Fi から外します") }
    }

    @ViewBuilder private func content(_ p: NPSHandyQrInfo) -> some View {
        NPOCard {
            VStack(spacing: 10) {
                if let url = p.url, let img = NPS.qrImage(url, scale: 12) {
                    Image(uiImage: img).interpolation(.none).resizable().scaledToFit().frame(width: 240, height: 240)
                        .padding(12).background(RoundedRectangle(cornerRadius: 16).fill(Color.white)).overlay(RoundedRectangle(cornerRadius: 16).stroke(NT.line, lineWidth: 1))
                    Text("スタッフの iPhone のカメラで読むとハンディが開きます").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink).multilineTextAlignment(.center)
                    HStack(spacing: 14) {
                        Label("使用中 \(p.activeDevices)台", systemImage: "iphone")
                        if p.wifiOnly { Label("お店のWi-Fiだけ", systemImage: "wifi") }
                    }
                    .font(.system(size: 12.5, weight: .semibold)).foregroundColor(NT.ink2)
                } else {
                    Image(systemName: "qrcode").font(.system(size: 40, weight: .semibold)).foregroundColor(NT.ink3)
                    Text("ハンディの QR がまだ作られていません").font(.system(size: 15, weight: NT.strong)).foregroundColor(NT.ink)
                    Text("お店の Wi-Fi につないだこの iPhone で「QRコードを作る」を押すと、今の回線をお店の Wi-Fi として登録して QR を作ります。")
                        .font(.system(size: 12.5)).foregroundColor(NT.ink2).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
                    NPOCWideButton(text: "QRコードを作る", icon: "qrcode", busy: model.busy == "setup", height: 46) {
                        Task { await model.run("setup", ["type": "handyQrSetup"], done: "QRコードを作りました") }
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        if p.url != nil {
            NPOCard(title: "使える場所") {
                NPSToggleRow(title: "お店のWi-Fiだけで使う", sub: p.wifiOnly ? "登録した回線の外に3分いると自動でログアウトします" : "QR を読めばどこからでも開きます（既定）",
                             isOn: Binding(get: { p.wifiOnly }, set: { v in Task { await model.run("wifi", ["type": "handyQrWifiOnly", "wifiOnly": v], done: v ? "お店のWi-Fiだけにしました" : "どこからでも開けるようにしました") } }),
                             disabled: model.busy != nil)
            }
            NPOCard(title: "お店の Wi-Fi（回線）", trailing: "\(p.networks.count)件") {
                if p.networks.isEmpty { Text("まだ登録していません").font(.system(size: 13)).foregroundColor(NT.ink3) }
                ForEach(p.networks) { n in
                    HStack(spacing: 8) {
                        Image(systemName: "wifi").font(.system(size: 13, weight: .bold)).foregroundColor(n.key == p.currentNetwork ? NT.ok : NT.ink3)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(n.label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink)
                            Text(n.key == p.currentNetwork ? "今この iPhone がつながっている回線" : "登録 \(NPZ.date(n.addedAt))").font(.system(size: 11)).foregroundColor(n.key == p.currentNetwork ? NT.ok : NT.ink3)
                        }
                        Spacer()
                        Button { confirmRemove = n } label: { Image(systemName: "trash").foregroundColor(NT.danger).frame(width: 36, height: 36) }
                            .buttonStyle(.plain).disabled(model.busy != nil)
                    }
                }
                if !p.currentIsShop && p.networks.count < (p.maxNetworks ?? 99) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("今この iPhone がつながっている回線を追加（お店の Wi-Fi につないでから）").font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink2)
                        TextField("名前（例：お店のWi-Fi・2階）", text: $model.networkLabel).font(.system(size: 15)).npocInputBox()
                        NPOCWideButton(text: "この回線を追加", icon: "plus", kind: .secondary, busy: model.busy == "add", height: 44) {
                            Task {
                                await model.run("add", ["type": "handyQrNetworkAdd", "label": model.networkLabel], done: "回線を追加しました")
                                model.networkLabel = ""
                            }
                        }
                    }
                    .padding(10).background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.lilac))
                }
            }
            NPOCard(title: "QR が外に出たとき") {
                Text("貼った QR の写真が出回ったときは作り直してください。古い QR では開けなくなり、今ログインしているハンディはすべてログアウトします。")
                    .font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                NPOCWideButton(text: "QRコードを作り直す", icon: "arrow.clockwise", kind: .danger, busy: model.busy == "regen", height: 46) { confirmRegen = true }
            }
        }
    }
}
