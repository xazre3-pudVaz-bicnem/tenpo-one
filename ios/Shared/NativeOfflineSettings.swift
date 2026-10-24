import SwiftUI

/// 設定の「ネットが無いときの印刷」（2026-10-24 Ronnie「net nachale pani print haru sabai kam」）。
/// この iPad に保存した印字キット・お店のプリンターの情報と、プリンターごとの送り方（Bluetooth・LAN・送れない）を見せ、
/// サーバーを通らずに見本を出す「テスト」ボタンを置く。
struct NativeOfflinePrintCard: View {
    @ObservedObject private var printConfig = NativePrintConfig.shared
    @ObservedObject private var net = NativeNet.shared
    @State private var kit: OfflineKit? = NativePrintKit.shared.kit
    @State private var ready = NativePrintKit.shared.ready
    @State private var busy: String?
    @State private var results: [NativeOfflinePrint.Outcome] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "wifi.slash").font(.system(size: 20, weight: .semibold)).foregroundColor(NFColor.iris).frame(width: 28).padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("ネットが無いときの印刷").font(.system(size: 17, weight: .heavy)).foregroundColor(NFColor.navy)
                        Text("Offline printing").font(.system(size: 12)).foregroundColor(NFColor.ink3)
                    }
                    Text("ネットが止まっても、この iPad から厨房伝票・会計伝票・レシート・取消伝票を直接プリンターへ出します（Bluetooth でつないだ機械か、LAN のアドレスがある機械）。印刷の形はいつもと同じです")
                        .font(.system(size: 13)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            Rectangle().fill(NFColor.line).frame(height: 1)

            line("準備", en: "Ready") {
                HStack(spacing: 6) {
                    Image(systemName: ready ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                        .foregroundColor(ready ? NFColor.success : NFColor.danger)
                    Text(ready ? "できています（\(kit?.store.name ?? "")）" : "まだです。ネットにつないで「読み直す」を押してください")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(ready ? NFColor.ink : NFColor.danger)
                }
            }
            if let kit {
                ForEach(kit.printers) { p in
                    line(p.name, en: p.usage == "receipt" ? "Receipt" : "Kitchen · \(p.stations.joined(separator: "/"))") {
                        let (text, color) = route(p)
                        Text(text).font(.system(size: 14, weight: .semibold)).foregroundColor(color)
                    }
                }
            }
            if !results.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(results.enumerated()), id: \.offset) { _, r in
                        HStack(spacing: 6) {
                            Image(systemName: r.ok ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundColor(r.ok ? NFColor.success : NFColor.danger)
                            Text(r.ok ? "\(r.printerName)：出しました" : "\(r.printerName)：\(r.code ?? "出せませんでした")")
                                .font(.system(size: 14, weight: .semibold)).foregroundColor(r.ok ? NFColor.ink : NFColor.danger)
                        }
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
            }
            HStack(spacing: 10) {
                button("テスト印刷（ネット無しの方式）", icon: "printer", primary: true, busy: busy == "test", disabled: !ready) {
                    Task {
                        busy = "test"; results = []
                        results = await NativeOfflinePrint.shared.test()
                        busy = nil
                    }
                }
                button("読み直す", icon: "arrow.clockwise", busy: busy == "refresh", disabled: !net.online) {
                    Task {
                        busy = "refresh"
                        await NativePrintKit.shared.refresh(force: true)
                        kit = NativePrintKit.shared.kit
                        ready = NativePrintKit.shared.ready
                        busy = nil
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
        }
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
        // 設定の背景が白なので、うすい影で浮かせる（設定のカードと同じ）
        .shadow(color: Color.black.opacity(0.05), radius: 6, y: 2)
        .onAppear {
            kit = NativePrintKit.shared.kit
            ready = NativePrintKit.shared.ready
        }
    }

    /// ネットが無いとき、このプリンターへどう送るか
    private func route(_ p: OfflineKit.Printer) -> (String, Color) {
        if let link = printConfig.config.appLinks.first(where: { $0.printerId == p.id }) {
            return ("Bluetooth（\(link.deviceName.isEmpty ? link.maker : link.deviceName)）で出せます", NFColor.success)
        }
        if let lan = p.lan { return ("LAN \(lan.host) で出せます", NFColor.success) }
        return ("ネットが無いと出せません（LAN のアドレスか Bluetooth の設定が必要）", NFColor.ink3)
    }

    private func line<Content: View>(_ label: String, en: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                Text(en).font(.system(size: 11)).foregroundColor(NFColor.ink3)
            }
            .frame(width: 200, alignment: .leading)
            content()
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private func button(_ text: String, icon: String? = nil, primary: Bool = false, busy: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(primary ? .white : NFColor.iris).scaleEffect(0.8) }
                else if let icon { Image(systemName: icon) }
                Text(text)
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundColor(primary ? .white : NFColor.ink)
            .padding(.horizontal, 18).frame(height: 48)
            .background(RoundedRectangle(cornerRadius: 12).fill(primary ? NFColor.iris : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(primary ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }
}
