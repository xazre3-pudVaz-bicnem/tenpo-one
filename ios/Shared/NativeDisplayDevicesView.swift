import SwiftUI
import CoreImage.CIFilterBuiltins

// MARK: - 設定 › デバイス管理 › ディスプレイ端末（Web の /app/settings/displays・components/settings/display-devices-panel.tsx と同じ）
// 店のモニター・タブレットを QR でつなぎ、キッチンディスプレイ（持ち場を絞れる）か呼び出しモニターにする（2026-10-24 Ronnie）。
// つないだ端末はログアウトしない（お店の回線の外では端末の画面に「お店の回線につないでください」と出るだけ）。
// 設定の一覧に出るのは、運営が企業・店舗の両方で ON にしたときだけ（lib/settings-hubs.ts）。
// 読み込み GET ?part=displayDevices ／ 操作 POST displayIssue・displayRename・displayUpdate
// （lib/native-modules/display-devices.ts。中身は Web と同じ app/app/settings/displays/actions.ts）
// 2026-10-25 Ronnie「端末のことは全部コントロールセンター」: 解除・承認・台数は TENPO ONE 運営（運営コンソール）。
// 新しくつないだ端末は承認待ち（approval = pending）。ここは見るだけ（QR の表示・名前・種類・持ち場は変えられる）

struct NDVDevice: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let kind: String
    let kindLabel: String
    let stations: [String]
    let stationsLabel: String
    let status: String
    let pairedAt: String
    let lastSeenAt: String?
    let pairedIp: String?
    let lastIp: String?
    let userAgent: String?
    let deviceModel: String
    /// TENPO ONE 運営の承認（pending / approved / rejected / revoked。古いサーバーは無し＝承認済み）
    var approval: String? = nil
}

struct NDVPayload: Codable {
    let store: NFNamed
    let canEdit: Bool
    let flagOn: Bool
    let flagMessage: String?
    /// migration 00103 未適用（表が無い）。一覧は空・QR は出さない
    let notReady: Bool
    /// QR に入れる登録ページ（https://…/display-pair#）。無ければ QR を作れない
    let pairBase: String?
    let kinds: [NSTLabeled]
    let stations: [NSTLabeled]
    let devices: [NDVDevice]
}

@MainActor
final class NativeDisplayDevicesModel: NSPModel<NDVPayload> {
    @Published var deviceName = "キッチンモニター"
    @Published var kind = "kitchen"
    @Published var stations: [String] = []
    /// 発行した QR（5分で消える）
    @Published var qr: NDVIssuedQr?
    /// 名前を変えている端末
    @Published var editingName: String?
    @Published var editName = ""
    /// 種類・持ち場を変えている端末
    @Published var editingKind: String?
    @Published var editKind = "kitchen"
    @Published var editStations: [String] = []

    init() { super.init(part: NativeSettingsPageKey.displays.rawValue) }

    func toggleStation(_ s: String) {
        if stations.contains(s) { stations.removeAll { $0 == s } } else { stations.append(s) }
    }
    func toggleEditStation(_ s: String) {
        if editStations.contains(s) { editStations.removeAll { $0 == s } } else { editStations.append(s) }
    }

    func issue() async {
        let n = deviceName.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { toast = "端末の名前を入力してください"; return }
        guard let base = payload?.pairBase else { toast = "公開URL（NEXT_PUBLIC_SITE_URL）が未設定のため、QRコードを作れません"; return }
        guard busy == nil else { return }
        busy = "issue"
        defer { busy = nil }
        let r = await NSPApi.postJSON(["type": "displayIssue", "deviceName": n, "kind": kind, "stations": stations])
        guard r.ok, let code = r.json?["code"] as? String else { toast = r.error ?? "QRコードを発行できませんでした"; return }
        let expMs = (r.json?["expiresAt"] as? String).flatMap { NFTime.ms(iso: $0) }
        let exp = expMs.map { Date(timeIntervalSince1970: $0 / 1000) } ?? Date().addingTimeInterval(300)
        // 登録画面は認証の外。コードは # 以降（サーバーへ送らない。Web と同じ）
        qr = NDVIssuedQr(url: base + code, expiresAt: exp)
    }
    func rename(_ d: NDVDevice) async {
        let n = editName.trimmingCharacters(in: .whitespaces)
        editingName = nil
        guard !n.isEmpty, n != d.name else { return }
        _ = await run(d.id, ["type": "displayRename", "id": d.id, "name": n], done: "名前を変えました")
    }
    func startEditKind(_ d: NDVDevice) {
        editingKind = d.id
        editKind = d.kind
        editStations = d.stations
    }
    func saveKind(_ d: NDVDevice) async {
        let ok = await run(d.id, ["type": "displayUpdate", "id": d.id, "kind": editKind, "stations": editStations], done: "種類・持ち場を変えました（端末の画面は自動で切り替わります）")
        if ok { editingKind = nil }
    }
}

/// 発行した QR（URL と期限）
struct NDVIssuedQr: Equatable {
    let url: String
    let expiresAt: Date
}

struct NativeDisplayDevicesScreen: View {
    @StateObject private var model = NativeDisplayDevicesModel()
    @EnvironmentObject var state: AppState
    var body: some View { NativeDisplayDevicesView(model: model, onBack: { state.goNativeSettings() }) }
}

struct NativeDisplayDevicesView: View {
    @ObservedObject var model: NativeDisplayDevicesModel
    let onBack: () -> Void
    @State private var now = Date()
    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "ディスプレイ端末", en: "Display monitors", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                if !p.flagOn { offNotice(p) }
                if p.canEdit && p.flagOn { pairCard(p) }
                devicesCard(p)
            }
        }
        .onReceive(tick) { now = $0 }
        .task { if NativePreview.current == nil { await model.refresh() } }
    }

    /// 運営が OFF にしているとき・migration 未適用のとき
    private func offNotice(_ p: NDVPayload) -> some View {
        let base = p.flagMessage ?? "この機能は使えません（運営にお問い合わせください）"
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 16, weight: .semibold)).foregroundColor(NFColor.saffron)
            Text(base).font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.saffronSoft))
    }

    private func pairCard(_ p: NDVPayload) -> some View {
        NSPCard(title: "モニターをディスプレイとしてつなぐ", en: "Pair a display", note: "モニター・タブレットをこの iPad と同じお店の回線（Wi-Fi・有線）につないでから、QR を読み取ってください。つないだ端末はログアウトしません") {
            VStack(alignment: .leading, spacing: 14) {
                NSPInput(text: $model.deviceName, placeholder: "端末の名前（例：厨房モニター・受け渡し口）", width: 360)
                VStack(alignment: .leading, spacing: 6) {
                    Text("種類").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
                    chips(p.kinds, isOn: { model.kind == $0 }, pick: { model.kind = $0 })
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.kind == "call" ? "呼び出しの対象の持ち場（何も選ばない＝すべて）" : "出す持ち場（何も選ばない＝すべて）")
                        .font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink2)
                    chips(p.stations, isOn: { model.stations.contains($0) }, pick: { model.toggleStation($0) })
                }
                NSPButton(text: "QRコードを表示", icon: "qrcode", primary: true, busy: model.busy == "issue", disabled: p.pairBase == nil) {
                    Task { await model.issue() }
                }
                if let q = model.qr { qrBlock(q) }
                if p.pairBase == nil {
                    Text("公開URL（NEXT_PUBLIC_SITE_URL）が未設定のため、QRコードを作れません").font(.system(size: 13)).foregroundColor(NFColor.danger)
                }
            }
            .padding(18)
        }
    }

    @ViewBuilder private func qrBlock(_ q: NDVIssuedQr) -> some View {
        let left = max(0, Int(q.expiresAt.timeIntervalSince(now)))
        if left > 0 {
            HStack(alignment: .top, spacing: 20) {
                if let img = Self.qrImage(q.url) {
                    Image(uiImage: img).interpolation(.none).resizable().scaledToFit().frame(width: 220, height: 220)
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("モニター・タブレットのカメラでこの QR を読んでください").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                    Text("TENPO ONE のアプリの iPad は、ログイン画面の「この iPad をディスプレイにする」から読みます").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("あと \(left / 60):\(String(format: "%02d", left % 60))").font(.system(size: 22, weight: .heavy)).foregroundColor(NFColor.iris).monospacedDigit()
                    NSPButton(text: "一覧を読み直す", icon: "arrow.clockwise") { Task { await model.refresh() } }
                }
            }
        } else {
            Text("QR の有効期限が切れました。もう一度「QRコードを表示」を押してください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
        }
    }

    private func devicesCard(_ p: NDVPayload) -> some View {
        NSPCard(title: "つないでいる端末", en: "Displays") {
            VStack(spacing: 0) {
                if p.devices.isEmpty {
                    Text(p.flagOn ? "まだ端末がありません。上の「QRコードを表示」からつないでください" : "まだ端末がありません")
                        .font(.system(size: 14)).foregroundColor(NFColor.ink3).padding(18)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(p.devices) { d in deviceRow(p, d) }
                Text("端末の追加の承認・解除・台数は TENPO ONE 運営（コントロールセンター）で行います。新しくつないだ端末は、承認されると画面が出ます")
                    .font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(18)
            }
        }
    }

    private func deviceRow(_ p: NDVPayload, _ d: NDVDevice) -> some View {
        let revoked = d.status == "revoked"
        let waiting = !revoked && d.approval == "pending"
        let on = !revoked && Self.isOnline(d.lastSeenAt, now: now)
        let ip = d.lastIp ?? d.pairedIp
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Image(systemName: d.kind == "call" ? "bell.badge" : "tv").font(.system(size: 16, weight: .semibold))
                    .foregroundColor(revoked ? NFColor.ink3 : NFColor.iris)
                    .frame(width: 36, height: 36)
                    .background(RoundedRectangle(cornerRadius: 10).fill(revoked ? NFColor.lilacSoft : NFColor.irisSoft))
                if model.editingName == d.id {
                    NSPInput(text: $model.editName, placeholder: "端末の名前", width: 280)
                    NSPButton(text: "決定", primary: true) { Task { await model.rename(d) } }
                    NSPButton(text: "やめる") { model.editingName = nil }
                } else {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(d.name).font(.system(size: 16, weight: .bold)).foregroundColor(revoked ? NFColor.ink3 : NFColor.ink)
                                .strikethrough(revoked, color: NFColor.ink3)
                            Text(d.kindLabel).font(.system(size: 11, weight: .bold)).foregroundColor(.white)
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(Capsule().fill(revoked ? NFColor.ink3 : NFColor.navy))
                            if revoked {
                                Text(d.approval == "rejected" ? "却下（運営）" : d.approval == "revoked" ? "解除（運営）" : "解除済み").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                                    .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac))
                            }
                            if waiting {
                                Text("承認待ち").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.danger)
                                    .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(NFColor.lilac))
                            }
                        }
                        // いま使っているか（3分以内に通信）・どの端末か（機種・OS）・持ち場
                        HStack(spacing: 6) {
                            if !revoked {
                                Circle().fill(on ? NFColor.success : NFColor.ink3.opacity(0.5)).frame(width: 8, height: 8)
                                Text(on ? "使用中" : "未使用").font(.system(size: 12, weight: .bold)).foregroundColor(on ? NFColor.success : NFColor.ink3)
                            }
                            Text(d.deviceModel).font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink2)
                            Text("持ち場 \(d.stationsLabel)").font(.system(size: 12, weight: .semibold)).foregroundColor(NFColor.ink2)
                        }
                        Text("登録 \(Self.pretty(d.pairedAt))　最後に通信 \(d.lastSeenAt.map(Self.pretty) ?? "—")\(ip.map { "　IP \($0)" } ?? "")")
                            .font(.system(size: 12)).foregroundColor(NFColor.ink3).lineLimit(1)
                    }
                }
                Spacer()
                if p.canEdit && !revoked && model.editingName != d.id {
                    if p.flagOn { NSPButton(text: "種類・持ち場", icon: "slider.horizontal.3") { model.startEditKind(d) } }
                    NSPButton(text: "名前", icon: "pencil") { model.editingName = d.id; model.editName = d.name }
                }
            }
            if model.editingKind == d.id && !revoked {
                VStack(alignment: .leading, spacing: 10) {
                    chips(p.kinds, isOn: { model.editKind == $0 }, pick: { model.editKind = $0 })
                    chips(p.stations, isOn: { model.editStations.contains($0) }, pick: { model.toggleEditStation($0) })
                    Text("持ち場を何も選ばない＝すべて。端末の画面は自動で切り替わります").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    HStack(spacing: 10) {
                        NSPButton(text: "保存する", primary: true, busy: model.busy == d.id) { Task { await model.saveKind(d) } }
                        NSPButton(text: "やめる") { model.editingKind = nil }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NFColor.lilacSoft))
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .frame(minHeight: 62)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    /// 選ぶボタンの並び（種類は1つ・持ち場はいくつでも）
    private func chips(_ list: [NSTLabeled], isOn: @escaping (String) -> Bool, pick: @escaping (String) -> Void) -> some View {
        WrapLayout(spacing: 8) {
            ForEach(list) { o in
                Button { pick(o.id) } label: {
                    Text(o.label).font(.system(size: 14, weight: .bold)).foregroundColor(isOn(o.id) ? .white : NFColor.ink2)
                        .padding(.horizontal, 14).frame(height: 40)
                        .background(RoundedRectangle(cornerRadius: 10).fill(isOn(o.id) ? NFColor.navy : Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
            }
        }
    }

    static func qrImage(_ s: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    /// 3分以内に通信していれば「使用中」（lib/display-monitor.ts の isDisplayOnline と同じ）
    static func isOnline(_ iso: String?, now: Date) -> Bool {
        guard let iso, let ms = NFTime.ms(iso: iso) else { return false }
        return now.timeIntervalSince1970 * 1000 - ms < 180_000
    }

    /// 「10/25 12:34」（日本時間）
    static func pretty(_ iso: String) -> String {
        guard let ms = NFTime.ms(iso: iso) else { return iso }
        let o = DateFormatter()
        o.dateFormat = "M/d HH:mm"
        o.timeZone = TimeZone(identifier: "Asia/Tokyo")
        return o.string(from: Date(timeIntervalSince1970: ms / 1000))
    }
}
