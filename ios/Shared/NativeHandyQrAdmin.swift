import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins

// 設定 › iPhoneハンディ（iPad ネイティブ。Web の /app/settings/handy-qr・components/settings/handy-qr-panel.tsx と同じ働き）。
// 2026-10-25 Ronnie「Make everything 101% native. We no longer need the Web iPad version」
//   今までは「QR の作り直し・Wi-Fi の設定」が Web の画面を開こうとして、同じネイティブの画面に戻るだけだった。
//   左：QR（無ければ「QRコードを作る」）・印刷する（PDF を QuickLook で見る→印刷・共有）・作り直す・ログイン中の台数・使い方
//   右：お店のWi-Fiだけで使う（オン・オフ）・登録した回線（外す）・この iPad の回線（登録済み／未登録）・この回線を追加
// 読み込み GET part=handyQrAdmin ／ 操作 POST { type: 'handyQr…' }（lib/native-modules/handy-qr.ts。中身は Web と同じ Server Action）

struct NHQANetwork: Codable, Identifiable, Hashable {
    let key: String
    let label: String
    let addedAt: String
    var id: String { key }
}

struct NHQAPayload: Codable {
    let store: NFNamed
    let url: String?
    let wifiOnly: Bool
    let networks: [NHQANetwork]
    let currentNetwork: String?
    let currentIsShop: Bool
    let activeDevices: Int
    let maxNetworks: Int
}

@MainActor
final class NativeHandyQrAdminModel: ObservableObject {
    @Published var payload: NHQAPayload?
    @Published var error: String?
    @Published var toast: String?
    /// 操作中のもの（ボタンのくるくる）
    @Published var busy: String?
    @Published var label = ""

    static let part = "handyQrAdmin"

    func refresh() async {
        if NativePreview.current != nil { return }
        do {
            if payload == nil, let saved = NativeModuleAPI.cached(NHQAPayload.self, part: Self.part) { payload = saved }
            payload = try await NativeModuleAPI.get(NHQAPayload.self, part: Self.part)
            error = nil
        } catch {
            if payload == nil { self.error = NativeModuleAPI.message(error) }
        }
    }

    /// 操作して読み直す。失敗したら toast
    @discardableResult
    func run(_ key: String, _ body: [String: Any], done: String) async -> Bool {
        guard busy == nil else { return false }
        if NativePreview.current != nil { toast = done; return true }
        busy = key
        defer { busy = nil }
        let r = await NSPApi.post(body)
        guard r.ok else { toast = r.error ?? "うまくいきませんでした"; return false }
        await refresh()
        toast = done
        return true
    }

    /// QR を作る（この iPad の回線も「お店のWi-Fi」に。IPv4 / IPv6 の両方を調べて送る＝Web のレジの画面と同じ）
    func setup() async {
        let ips = await Self.lookupIps()
        await run("setup", ["type": "handyQrSetup", "extraIps": ips], done: "QRコードを作りました")
    }

    func regenerate() async {
        await run("regen", ["type": "handyQrRegenerate"], done: "QRコードを作り直しました")
    }

    func setWifiOnly(_ on: Bool) async {
        await run("wifi", ["type": "handyQrWifiOnly", "wifiOnly": on], done: on ? "お店のWi-Fiだけで使うようにしました" : "どこからでも開けるようにしました")
    }

    func addCurrentNetwork() async {
        let ips = await Self.lookupIps()
        if await run("add", ["type": "handyQrNetworkAdd", "label": label, "extraIps": ips], done: "回線を追加しました") { label = "" }
    }

    func remove(_ n: NHQANetwork) async {
        await run("rm" + n.key, ["type": "handyQrNetworkRemove", "key": n.key], done: "回線を外しました")
    }

    /// この回線の IPv4 / IPv6（api.ipify.org / api6.ipify.org。片方しか無ければ片方だけ。3 秒で諦める）
    static func lookupIps() async -> [String] {
        async let v4 = ip(from: "https://api.ipify.org?format=json")
        async let v6 = ip(from: "https://api6.ipify.org?format=json")
        return [await v4, await v6].compactMap { $0 }
    }

    private static func ip(from s: String) async -> String? {
        guard let url = URL(string: s) else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 3
        req.cachePolicy = .reloadIgnoringLocalCacheData
        guard let result = try? await URLSession.shared.data(for: req),
              let json = (try? JSONSerialization.jsonObject(with: result.0)) as? [String: Any],
              let ip = json["ip"] as? String, !ip.isEmpty, ip.count <= 45 else { return nil }
        return ip
    }

    /// 見本（-tenpoNativePreview handyQrAdmin）。架空の店・回線
    static func sample() -> NativeHandyQrAdminModel {
        let m = NativeHandyQrAdminModel()
        m.payload = NHQAPayload(
            store: NFNamed(id: "s1", name: "TENPO ONE 新宿店"),
            url: "https://example.com/handy-join#0123456789abcdef0123456789abcdef0123456789abcdef",
            wifiOnly: true,
            networks: [
                NHQANetwork(key: "203.0.113.5", label: "レジの回線", addedAt: "2026-10-01T10:00:00.000Z"),
                NHQANetwork(key: "2001:db8:1:2", label: "レジの回線（IPv6）", addedAt: "2026-10-01T10:00:00.000Z"),
            ],
            currentNetwork: "198.51.100.7",
            currentIsShop: false,
            activeDevices: 3,
            maxNetworks: 5
        )
        return m
    }
}

/// QR の絵と、印刷する PDF（A4 1枚。店名・QR・読み方）
enum NHQAArt {
    static func qrImage(_ s: String, scale: CGFloat = 12) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    /// A4（595×842pt）の PDF。Web の「印刷する」（小さいウィンドウで window.print）と同じ中身
    static func pdf(storeName: String, url: String, wifiOnly: Bool) -> Data? {
        guard let qr = qrImage(url, scale: 20) else { return nil }
        let page = CGRect(x: 0, y: 0, width: 595, height: 842)
        let fmt = UIGraphicsPDFRendererFormat()
        fmt.documentInfo = [kCGPDFContextTitle as String: "\(storeName) ハンディ QR", kCGPDFContextCreator as String: "TENPO ONE"]
        let renderer = UIGraphicsPDFRenderer(bounds: page, format: fmt)
        return renderer.pdfData { c in
            c.beginPage()
            let center = NSMutableParagraphStyle()
            center.alignment = .center
            func draw(_ text: String, y: CGFloat, size: CGFloat, weight: UIFont.Weight, color: UIColor = .black) {
                let attrs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: center]
                (text as NSString).draw(in: CGRect(x: 40, y: y, width: page.width - 80, height: size * 2.6), withAttributes: attrs)
            }
            draw(storeName, y: 110, size: 26, weight: .heavy)
            draw("ハンディ（iPhone のカメラで読み取り）", y: 158, size: 16, weight: .semibold)
            let side: CGFloat = 340
            c.cgContext.interpolationQuality = .none
            qr.draw(in: CGRect(x: (page.width - side) / 2, y: 220, width: side, height: side))
            draw(wifiOnly ? "お店のWi-Fiにつないでから読み取ってください" : "iPhone のカメラで読み取ると、そのままハンディが開きます", y: 590, size: 14, weight: .regular, color: .darkGray)
            draw("TENPO ONE", y: 780, size: 10, weight: .semibold, color: .lightGray)
        }
    }
}

struct NativeHandyQrAdminView: View {
    let onBack: () -> Void
    @StateObject private var model: NativeHandyQrAdminModel
    @State private var confirmRegen = false
    @State private var printFile: NativeSharedFile?

    init(onBack: @escaping () -> Void, model: NativeHandyQrAdminModel? = nil) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeHandyQrAdminModel())
    }

    var body: some View {
        NSPFrame(storeName: model.payload?.store.name ?? "", title: "iPhoneハンディ", en: "Handy QR", loaded: model.payload != nil, error: model.error, toast: $model.toast, onBack: onBack, retry: { await model.refresh() }) {
            if let p = model.payload {
                HStack(alignment: .top, spacing: 18) {
                    qrCard(p).frame(width: 440)
                    wifiCard(p)
                }
            }
        }
        .task { await model.refresh() }
        .alert("QRコードを作り直す", isPresented: $confirmRegen) {
            Button("作り直す", role: .destructive) { Task { await model.regenerate() } }
            Button("やめる", role: .cancel) {}
        } message: {
            Text("古いQRコードでは開けなくなり、いまログインしているハンディもすべてログアウトします。新しいQRを印刷して貼り替えてください。")
        }
        .sheet(item: $printFile) { f in NativeQuickLookSheet(url: f.url).ignoresSafeArea() }
    }

    // MARK: 左：QR

    private func qrCard(_ p: NHQAPayload) -> some View {
        NSPCard(title: "ハンディのQRコード", en: p.store.name, note: p.url == nil ? nil : "毎日同じQRです。印刷してレジ横やバックヤードに貼ってください。") {
            VStack(spacing: 16) {
                if let url = p.url {
                    if let img = NHQAArt.qrImage(url) {
                        Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
                            .frame(width: 260, height: 260)
                            .padding(14)
                            .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
                    }
                    HStack(spacing: 10) {
                        NSPButton(text: "印刷する", icon: "printer", primary: true) { openPrint(p, url: url) }
                        NSPButton(text: "QRを作り直す", icon: "arrow.clockwise", busy: model.busy == "regen") { confirmRegen = true }
                    }
                    Label("いまログインしているハンディ：\(p.activeDevices)台", systemImage: "iphone")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(NFColor.ink2)
                    VStack(alignment: .leading, spacing: 5) {
                        let steps = p.wifiOnly
                            ? ["iPhone をお店のWi-Fiにつなぐ", "iPhone のカメラでこのQRを読む → ハンディがそのまま開く", "お店のWi-Fiの外に3分いると自動でログアウト。戻ったらQRを読み直す"]
                            : ["iPhone のカメラでこのQRを読む → ハンディがそのまま開く", "アプリの TENPO ONE を入れた iPhone は、アプリの QR の画面で読む"]
                        ForEach(Array(steps.enumerated()), id: \.offset) { i, s in
                            Text("\(i + 1). \(s)").font(.system(size: 13)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Text("お店に1つだけの「ハンディのQRコード」を作ります。スタッフは iPhone のカメラでこのQRを読むだけで、ハンディが開きます（パスワードなし）。")
                        .font(.system(size: 14)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                    Text("この iPad の回線も「お店のWi-Fi」として覚えておきます（あとで「お店のWi-Fiだけで使う」をオンにしたときに使います）。")
                        .font(.system(size: 12.5)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft))
                    NSPButton(text: "QRコードを作る", icon: "qrcode", primary: true, busy: model.busy == "setup") { Task { await model.setup() } }
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity)
        }
    }

    /// 印刷：iPad の中で A4 の PDF を作って QuickLook（右上から印刷・共有・ファイルに保存）
    private func openPrint(_ p: NHQAPayload, url: String) {
        guard let data = NHQAArt.pdf(storeName: p.store.name, url: url, wifiOnly: p.wifiOnly),
              let file = NativeFileShare.save(data, name: "\(p.store.name)_ハンディQR.pdf") else {
            model.toast = "PDF を作れませんでした"
            return
        }
        printFile = NativeSharedFile(url: file)
    }

    // MARK: 右：お店の Wi-Fi

    private static func wifiNote(_ wifiOnly: Bool) -> String {
        let middle = wifiOnly
            ? "ここに登録した回線からだけQRで開け、それ以外（スマホの回線・ほかのWi-Fi）に3分いるとログアウトします。"
            : "「お店のWi-Fiだけで使う」がオフの間は、この一覧は使われません。"
        return "Wi-Fi の名前は読めないため、お店のインターネット回線で「お店のWi-Fiか」を判定します。" + middle
            + "ルーターの再起動などで回線が変わったら、お店のWi-Fiにつないだこの iPad で「この回線を追加」を押してください。"
    }

    private func wifiCard(_ p: NHQAPayload) -> some View {
        NSPCard(title: "お店のWi-Fi", en: "インターネット回線") {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center, spacing: 14) {
                    VStack(alignment: .leading, spacing: 3) {
                        Label("お店のWi-Fiだけで使う", systemImage: "checkmark.shield").font(.system(size: 16, weight: .bold)).foregroundColor(NFColor.navy)
                        Text(p.wifiOnly
                             ? "オン：下に登録した回線からだけQRで開け、外に3分いると自動でログアウトします"
                             : "オフ：QRを読めばどこからでも開きます（iPhone のプライベートリレーがオンでも大丈夫）")
                            .font(.system(size: 12.5)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    if model.busy == "wifi" { ProgressView().tint(NFColor.iris) }
                    NSPToggle(on: p.wifiOnly, disabled: model.busy != nil) { Task { await model.setWifiOnly(!p.wifiOnly) } }
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.lilacSoft))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))

                Text(Self.wifiNote(p.wifiOnly))
                    .font(.system(size: 12.5)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 8) {
                    Image(systemName: p.currentIsShop ? "wifi" : "wifi.slash").foregroundColor(p.currentIsShop ? NFColor.success : NFColor.saffron)
                    Text("この iPad の回線：").font(.system(size: 13)).foregroundColor(NFColor.ink2)
                    Text(p.currentNetwork ?? "不明").font(.system(size: 13, weight: .regular, design: .monospaced)).foregroundColor(NFColor.ink)
                    Text(p.currentIsShop ? "登録済み" : "未登録")
                        .font(.system(size: 11, weight: NT.strong)).foregroundColor(p.currentIsShop ? NFColor.success : NFColor.saffron)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(p.currentIsShop ? NFColor.successSoft : NFColor.saffronSoft))
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilac))

                VStack(spacing: 0) {
                    ForEach(p.networks) { n in
                        HStack(spacing: 10) {
                            Text(n.label.isEmpty ? "お店のWi-Fi" : n.label).font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.ink)
                            Text(n.key).font(.system(size: 12, weight: .regular, design: .monospaced)).foregroundColor(NFColor.ink3).lineLimit(1)
                            Spacer(minLength: 8)
                            Button { Task { await model.remove(n) } } label: {
                                if model.busy == "rm" + n.key { ProgressView().tint(NFColor.danger) }
                                else { Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.danger) }
                            }
                            .buttonStyle(PressableStyle()).frame(width: 44, height: 44).disabled(model.busy != nil)
                            .accessibilityLabel("外す")
                        }
                        .padding(.horizontal, 12)
                        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
                    }
                    if p.networks.isEmpty {
                        Text(p.wifiOnly ? "回線が登録されていないため、いまはどこからでも開ける状態です。「この回線を追加」を押してください。" : "回線は登録されていません。")
                            .font(.system(size: 12.5)).foregroundColor(p.wifiOnly ? NFColor.loInk : NFColor.ink3)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 10).fill(p.wifiOnly ? NFColor.loSoft : NFColor.lilacSoft))
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(p.networks.isEmpty ? Color.clear : NFColor.line, lineWidth: 1))

                if !p.currentIsShop {
                    HStack(spacing: 10) {
                        TextField("名前（例: 3F Wi-Fi）", text: $model.label)
                            .font(.system(size: 15)).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .padding(.horizontal, 12).frame(width: 220, height: 46)
                            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                        NSPButton(text: "この回線を追加", icon: "plus", primary: true, busy: model.busy == "add") { Task { await model.addCurrentNetwork() } }
                        Spacer(minLength: 0)
                    }
                }
                if p.networks.count >= p.maxNetworks {
                    Text("登録できる回線は \(p.maxNetworks) つまでです（足すと古いものから外れます）").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                }
            }
            .padding(20)
        }
    }
}

/// 見本（-tenpoNativePreview handyQrAdmin。iPad は -tenpoNativeLandscape YES も）
struct NativeHandyQrAdminPreview: View {
    var body: some View { NativeHandyQrAdminView(onBack: {}, model: NativeHandyQrAdminModel.sample()) }
}
