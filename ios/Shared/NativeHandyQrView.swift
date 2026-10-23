import SwiftUI
import CoreImage.CIFilterBuiltins

// iPhoneハンディの QR（ネイティブ）。Web の /app/settings/handy-qr の QR を大きく出す（2026-10-24）
//   スタッフの iPhone のカメラで読むとハンディが開く。作り直し・お店の Wi-Fi の登録は管理画面（設定 > iPhoneハンディ）

struct NHQPayload: Codable { let store: NFNamed; let url: String?; let wifiOnly: Bool; let activeDevices: Int }

struct NativeHandyQrSheet: View {
    let onClose: () -> Void
    let onWeb: (String) -> Void

    @State private var payload: NHQPayload?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                if let p = payload {
                    if let url = p.url, let img = qrImage(url) {
                        Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
                            .frame(width: 340, height: 340)
                            .padding(16)
                            .background(RoundedRectangle(cornerRadius: 20).fill(Color.white))
                            .overlay(RoundedRectangle(cornerRadius: 20).stroke(NFColor.line, lineWidth: 1))
                        VStack(spacing: 4) {
                            Text("iPhone のカメラで読むとハンディが開きます").font(.system(size: 17, weight: .bold))
                            Text("Scan with the iPhone camera to open the handy").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                        }
                        HStack(spacing: 16) {
                            Label("使用中 \(p.activeDevices)台", systemImage: "iphone").font(.system(size: 14))
                            if p.wifiOnly { Label("お店のWi-Fiだけ", systemImage: "wifi").font(.system(size: 14)) }
                        }
                        .foregroundColor(NFColor.ink2)
                    } else {
                        Text("ハンディの QR がまだ作られていません").font(.system(size: 16, weight: .bold))
                        Text("設定 > iPhoneハンディ で作成してください").font(.system(size: 13)).foregroundColor(NFColor.ink3)
                    }
                    Button { onWeb("/app/settings/handy-qr") } label: {
                        Label("QR の作り直し・Wi-Fi の設定", systemImage: "gearshape").font(.system(size: 14, weight: .bold))
                    }.buttonStyle(.bordered)
                } else if let error {
                    Text(error).foregroundColor(NFColor.danger)
                } else {
                    ProgressView()
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(NFColor.lilacSoft)
            .navigationTitle("iPhoneハンディ / Handy QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) } }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "handyqr")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NHQPayload.self, from: data)
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
        }
    }

    private func qrImage(_ s: String) -> UIImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8)
        f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
