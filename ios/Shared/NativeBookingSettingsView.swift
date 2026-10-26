import SwiftUI
import UIKit

// 予約設定＝予約受付ルール（ネイティブ）。Web の /app/settings/booking（BookingSettingsForm）と同じ項目・同じ決まり（2026-10-24）
//   予約枠間隔（15/30/60分）・既定の滞在時間・予約受付締切・予約受付期間・最大人数・キャンセル期限・清掃バッファ
//   公開予約ページの表示内容（店舗写真＝食べログ等の URL から取り込み・ご予約時の注意事項・キャンセルポリシー）
//   予約リマインダー（有効・来店何時間前）
// レジ端末（iPad の「<店舗名>（レジ）」アカウント）は Web と同じく「管理画面で変更してください」（2026-09-29 Ronnie「管理画面」）。
// 保存の中身は Web と同じ Server Action（updateBookingSettings）。レイアウト・色は他のネイティブ画面と同じ。

struct NBKSettings: Codable, Equatable {
    /// サーバーが無いときの既定（Web の page.tsx の ?? と同じ）
    static let defaults = NBKSettings(slotMinutes: 30, defaultStayMinutes: 120, bookingCutoffMinutes: 120, bookingWindowDays: 90, maxPartySize: 12, cancelDeadlineHours: 24, cleaningBufferMinutes: 0, bookingPhotoUrl: "", bookingNotes: "", cancellationPolicy: "", reminderEnabled: false, reminderHoursBefore: 24)
    var slotMinutes: Int
    var defaultStayMinutes: Int
    var bookingCutoffMinutes: Int
    var bookingWindowDays: Int
    var maxPartySize: Int
    var cancelDeadlineHours: Int
    var cleaningBufferMinutes: Int
    var bookingPhotoUrl: String
    var bookingNotes: String
    var cancellationPolicy: String
    var reminderEnabled: Bool
    var reminderHoursBefore: Int
}

struct NBKPayload: Codable {
    let store: NFNamed
    let adminOnly: Bool
    let adminOnlyNote: String
    let bookingEnabled: Bool
    let bookingUrl: String?
    let settings: NBKSettings
}

@MainActor
final class NativeBookingSettingsModel: ObservableObject {
    @Published var payload: NBKPayload?
    @Published var error: String?
    @Published var toast: String?
    @Published var busy = false
    @Published var importing = false

    func refresh() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "bookingSettings")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NBKPayload.self, from: data)
            error = nil
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    /// 保存（Web の updateBookingSettings）。成功したら true
    func save(_ s: NBKSettings) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let body: [String: Any] = [
                "type": "bookingSettingsSave",
                "slotMinutes": s.slotMinutes,
                "defaultStayMinutes": s.defaultStayMinutes,
                "bookingCutoffMinutes": s.bookingCutoffMinutes,
                "bookingWindowDays": s.bookingWindowDays,
                "maxPartySize": s.maxPartySize,
                "cancelDeadlineHours": s.cancelDeadlineHours,
                "cleaningBufferMinutes": s.cleaningBufferMinutes,
                "bookingPhotoUrl": s.bookingPhotoUrl,
                "bookingNotes": s.bookingNotes,
                "cancellationPolicy": s.cancellationPolicy,
                "reminderEnabled": s.reminderEnabled,
                "reminderHoursBefore": s.reminderHoursBefore,
            ]
            let r = try await NativeAPI.shared.floorAct(body)
            if !r.ok { error = r.error ?? "保存に失敗しました"; return false }
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }

    /// 食べログ・ホットペッパー・ホームページの URL から店舗写真を取り込む（Web の importStorePhotoFromPage）。保存した写真の URL を返す
    func importPhoto(pageUrl: String) async -> String? {
        importing = true
        defer { importing = false }
        do {
            struct R: Decodable { let ok: Bool; let error: String?; let photoUrl: String? }
            let r = try await NativeAPI.shared.ledgerPost(["type": "bookingPhotoImport", "pageUrl": pageUrl], as: R.self)
            if !r.ok { error = r.error ?? "写真を取り込めませんでした"; return nil }
            return r.photoUrl
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return nil
        }
    }
}

struct NativeBookingSettingsView: View {
    @ObservedObject var model: NativeBookingSettingsModel
    let onHome: () -> Void
    /// 店舗台帳へ戻る（Web の「設定へ戻る」の代わり。台帳の 📅 から来るため）
    let onLedger: () -> Void
    let onWeb: (String) -> Void

    @State private var form: NBKSettings?
    @State private var pageUrl = ""
    @FocusState private var focused: Field?

    private enum Field: Hashable { case stay, cutoff, window, party, cancel, buffer, photoPage, notes, policy, reminder }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: model.payload?.store.name ?? "", title: "予約受付ルール", subtitle: "", onHome: onHome)
            if let p = model.payload {
                if p.adminOnly {
                    adminOnlyView(p)
                } else if form != nil {
                    formView(p)
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
        .modifier(NPToastError(error: $model.error, toast: $model.toast, hasPayload: model.payload != nil))
        .task {
            await model.refresh()
            if let p = model.payload, form == nil { form = p.settings }
        }
    }

    // MARK: - レジ端末＝見るだけ（Web の EmptyState「管理画面で変更してください」と同じ）

    private func adminOnlyView(_ p: NBKPayload) -> some View {
        VStack(spacing: 0) {
            header(p)
            Spacer()
            VStack(spacing: 12) {
                Image(systemName: "lock.shield").font(.system(size: 40, weight: .semibold)).foregroundColor(NFColor.ink3)
                Text("管理画面で変更してください").font(.system(size: 20, weight: NT.strong)).foregroundColor(NFColor.navy)
                Text(p.adminOnlyNote).font(.system(size: 14)).foregroundColor(NFColor.ink2).multilineTextAlignment(.center).frame(maxWidth: 520)
            }
            .padding(32)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 18).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(NFColor.line, lineWidth: 1))
            .padding(.horizontal, 120)
            Spacer()
        }
        .padding(16)
    }

    // MARK: - 上の行（店名・公開予約ページを確認・停止中の帯）

    private func header(_ p: NBKPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button(action: onLedger) {
                    HStack(spacing: 3) { Image(systemName: "chevron.left"); Text("店舗台帳へ戻る") }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
                }.buttonStyle(.plain).padding(.trailing, 8)
                Text(p.store.name).font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                Spacer()
                if let u = p.bookingUrl, let url = URL(string: u) {
                    Button { UIApplication.shared.open(url) } label: {
                        HStack(spacing: 6) { Image(systemName: "arrow.up.right.square"); Text("公開予約ページを確認") }
                            .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
                            .padding(.horizontal, 14).frame(height: 40)
                            .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.wisteria, lineWidth: 1.5))
                    }.buttonStyle(PressableStyle())
                }
            }
            if !p.bookingEnabled {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("この店舗はオンライン予約が停止中です。受付を再開するには「店舗情報」設定で「オンライン予約を受け付ける」を有効にしてください。")
                    Spacer(minLength: 8)
                    Button { onWeb("/app/settings/store") } label: {
                        HStack(spacing: 3) { Text("店舗情報へ"); Image(systemName: "chevron.right") }.font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
                    }.buttonStyle(.plain)
                }
                .font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.loInk)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.loSoft))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.lo.opacity(0.4), lineWidth: 1))
            }
        }
    }

    // MARK: - 入力（Web の BookingSettingsForm と同じ順・同じ説明）

    private func formView(_ p: NBKPayload) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header(p)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    // 受付ルール
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            label("予約枠間隔")
                            Picker("", selection: slotBinding) {
                                Text("15分").tag(15); Text("30分").tag(30); Text("60分").tag(60)
                            }
                            .pickerStyle(.segmented).frame(height: 44)
                        }
                        .frame(maxWidth: .infinity)
                        numberField("既定の滞在時間（分）", binding(\.defaultStayMinutes), .stay)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        numberField("予約受付締切（分前）", binding(\.bookingCutoffMinutes), .cutoff)
                        numberField("予約受付期間（日先まで）", binding(\.bookingWindowDays), .window)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        numberField("最大人数", binding(\.maxPartySize), .party)
                        numberField("キャンセル期限（時間前）", binding(\.cancelDeadlineHours), .cancel)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        VStack(alignment: .leading, spacing: 6) {
                            numberField("清掃バッファ（分）", binding(\.cleaningBufferMinutes), .buffer)
                            hint("予約の間に清掃時間を確保します。空席判定で滞在時間+バッファが占有扱いになります（0〜120分）。")
                        }
                        .frame(maxWidth: .infinity)
                        Color.clear.frame(maxWidth: .infinity).frame(height: 1)
                    }

                    divider("公開予約ページの表示内容")

                    // 店舗写真（食べログ・ホットペッパー・ホームページの URL を貼ると、そのページの写真を取り込む。2026-09-28 Ronnie）
                    VStack(alignment: .leading, spacing: 6) {
                        label("店舗写真")
                        HStack(spacing: 8) {
                            TextField("食べログ・ホットペッパー・お店のホームページの URL を貼る（https://…）", text: $pageUrl)
                                .font(.system(size: 15)).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .focused($focused, equals: .photoPage)
                                .padding(.horizontal, 12).frame(height: 44)
                                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                            Button { Task { await importPhoto() } } label: {
                                HStack(spacing: 6) {
                                    if model.importing { ProgressView().tint(NFColor.royal) } else { Image(systemName: "photo.badge.arrow.down") }
                                    Text(model.importing ? "取り込み中…" : "写真を取り込む")
                                }
                                .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.royal)
                                .padding(.horizontal, 16).frame(height: 44)
                                .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.wisteria, lineWidth: 1.5))
                            }
                            .buttonStyle(PressableStyle())
                            .disabled(model.importing || pageUrl.trimmingCharacters(in: .whitespaces).isEmpty)
                            .opacity(model.importing || pageUrl.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)
                        }
                        hint("貼った URL のページの代表写真（お店の写真）を自動で取り込みます。食べログ・ホットペッパー・ホームページどれでも可。写真の URL（.jpg）を直接貼っても使えます。")
                        if let f = form, !f.bookingPhotoUrl.isEmpty, let url = URL(string: f.bookingPhotoUrl) {
                            HStack(spacing: 12) {
                                AsyncImage(url: url) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: {
                                    RoundedRectangle(cornerRadius: 10).fill(NFColor.lilac).overlay(ProgressView().tint(NFColor.ink3))
                                }
                                .frame(width: 128, height: 80).clipShape(RoundedRectangle(cornerRadius: 10))
                                VStack(alignment: .leading, spacing: 6) {
                                    hint("公開予約ページの上部に出ます。")
                                    Button { form?.bookingPhotoUrl = "" } label: {
                                        Text("写真を外す").font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.danger).underline()
                                    }.buttonStyle(.plain)
                                }
                                Spacer()
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        label("ご予約時の注意事項")
                        textArea(binding(\.bookingNotes), "例：コースは3日前までのご予約制です。お子様連れの場合は事前にご相談ください。", .notes)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        label("キャンセルポリシー")
                        textArea(binding(\.cancellationPolicy), "例：前日以降のキャンセルはご連絡をお願いします。無断キャンセルはご遠慮ください。", .policy)
                        hint("キャンセル料の自動請求は行いません。ポリシーの明示のみ表示します。")
                    }

                    divider("予約リマインダー")

                    HStack(alignment: .top, spacing: 24) {
                        Toggle(isOn: binding(\.reminderEnabled)) {
                            Text("リマインダーを有効にする").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.navy)
                        }
                        .tint(NFColor.iris).frame(width: 300)
                        VStack(alignment: .leading, spacing: 6) {
                            numberField("送信タイミング（来店何時間前）", binding(\.reminderHoursBefore), .reminder)
                                .disabled(!(form?.reminderEnabled ?? false)).opacity(form?.reminderEnabled ?? false ? 1 : 0.5)
                        }
                        .frame(width: 320)
                        Spacer()
                    }
                    Text("※ 外部メール/SMSプロバイダは未接続です。リマインダーは送信キューに積まれますが、実送信は接続後に有効になります。")
                        .font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.saffron)
                }
                .padding(20)
                .background(RoundedRectangle(cornerRadius: 18).fill(Color.white))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(NFColor.line, lineWidth: 1))
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            HStack(spacing: 10) {
                Spacer()
                Text(form == p.settings ? "変更はありません" : "未保存の変更があります").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                Button { Task { await save() } } label: {
                    HStack(spacing: 6) { Image(systemName: "square.and.arrow.down"); Text(model.busy ? "保存中…" : "保存する") }
                        .font(.system(size: 17, weight: NT.strong)).foregroundColor(.white)
                        .padding(.horizontal, 30).frame(height: 54)
                        .background(RoundedRectangle(cornerRadius: 14).fill(NFColor.iris))
                }
                .buttonStyle(PressableStyle()).disabled(model.busy).opacity(model.busy ? 0.6 : 1)
            }
        }
        .padding(16)
    }

    // MARK: - 部品

    private func label(_ t: String) -> some View { Text(t).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink2) }
    private func hint(_ t: String) -> some View { Text(t).font(.system(size: 12)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true) }

    private func divider(_ title: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Rectangle().fill(NFColor.line).frame(height: 1)
            Text(title).font(.system(size: 14, weight: NT.strong)).foregroundColor(NFColor.navy)
        }
        .padding(.top, 4)
    }

    /// 数字だけの入力（Web の type=number と同じ。空は 0）
    private func numberField(_ title: String, _ b: Binding<Int>, _ field: Field) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            label(title)
            TextField("", text: Binding(get: { b.wrappedValue == 0 && focused == field ? "" : String(b.wrappedValue) }, set: { s in
                let digits = s.filter(\.isNumber)
                b.wrappedValue = Int(digits.prefix(6)) ?? 0
            }))
            .font(.system(size: 16, weight: .semibold)).monospacedDigit().keyboardType(.numberPad)
            .focused($focused, equals: field)
            .padding(.horizontal, 12).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(focused == field ? NFColor.iris : NFColor.line, lineWidth: focused == field ? 2 : 1))
        }
        .frame(maxWidth: .infinity)
    }

    private func textArea(_ b: Binding<String>, _ placeholder: String, _ field: Field) -> some View {
        TextField(placeholder, text: b, axis: .vertical).lineLimit(3...8).font(.system(size: 15))
            .focused($focused, equals: field)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(focused == field ? NFColor.iris : NFColor.line, lineWidth: focused == field ? 2 : 1))
    }

    private func binding<T>(_ key: WritableKeyPath<NBKSettings, T>) -> Binding<T> {
        Binding(
            get: { (form ?? model.payload?.settings ?? NBKSettings.defaults)[keyPath: key] },
            set: { v in form?[keyPath: key] = v }
        )
    }

    private var slotBinding: Binding<Int> {
        Binding(get: { form?.slotMinutes ?? 30 }, set: { form?.slotMinutes = $0 })
    }

    // MARK: - 操作（Web の BookingSettingsForm と同じ決まり）

    private func importPhoto() async {
        let u = pageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !u.isEmpty else { return }
        focused = nil
        if let photo = await model.importPhoto(pageUrl: u) {
            form?.bookingPhotoUrl = photo
            pageUrl = ""
            model.toast = "写真を取り込みました"
        }
    }

    private func save() async {
        guard let f = form, !model.busy else { return }
        focused = nil
        // Web の updateBookingSettings と同じ決まりを先に見て、現場で分かる言葉で止める
        if ![15, 30, 60].contains(f.slotMinutes) { model.error = "予約枠間隔の指定が不正です"; return }
        if f.defaultStayMinutes <= 0 || f.bookingWindowDays <= 0 || f.maxPartySize <= 0 { model.error = "数値の指定が正しくありません"; return }
        if f.cleaningBufferMinutes > 120 { model.error = "清掃バッファは0〜120分で指定してください"; return }
        let photo = f.bookingPhotoUrl.trimmingCharacters(in: .whitespaces)
        if !photo.isEmpty && !(photo.hasPrefix("/") && !photo.hasPrefix("//")) && !photo.lowercased().hasPrefix("https://") {
            model.error = "写真URLは「/」で始まるパスか https:// で始まるURLを指定してください"; return
        }
        if await model.save(f) {
            model.toast = "予約設定を保存しました"
            await model.refresh()
            if let p = model.payload { form = p.settings }
        }
    }
}
