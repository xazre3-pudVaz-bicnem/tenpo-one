import SwiftUI

/// 設定の「ネットが無いときの印刷」（2026-10-24 Ronnie「net nachale pani print haru sabai kam」）。
/// この iPad に保存した印字キット・お店のプリンターの情報と、プリンターごとの送り方（Bluetooth・LAN・送れない）を見せ、
/// サーバーを通らずに見本を出す「テスト」ボタンを置く。
struct NativeOfflinePrintCard: View {
    @ObservedObject private var printConfig = NativePrintConfig.shared
    @ObservedObject private var net = NativeNet.shared
    @ObservedObject private var store = NativeOfflineStore.shared
    @State private var kit: OfflineKit? = NativePrintKit.shared.kit
    @State private var ready = NativePrintKit.shared.ready
    @State private var busy: String?
    @State private var results: [NativeOfflinePrint.Outcome] = []
    @State private var discardTarget: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                Text("ネットが無いときの印刷").font(.system(size: 18, weight: .heavy)).foregroundColor(NFColor.navy)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            Rectangle().fill(NFColor.line).frame(height: 1)

            line("準備", en: "") {
                HStack(spacing: 6) {
                    Image(systemName: ready ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                        .foregroundColor(ready ? NFColor.success : NFColor.danger)
                    Text(ready ? "できています（\(kit?.store.name ?? "")）" : "まだです。ネットにつないで「読み直す」を押してください")
                        .font(.system(size: 14, weight: .semibold)).foregroundColor(ready ? NFColor.ink : NFColor.danger)
                }
            }
            if let kit {
                // ネット無しで出せるプリンターだけ出す（LAN のアドレスも Bluetooth も無いものは出さない。
                // 2026-10-25 00:11 Ronnie「使えないものは出さないで」）
                let usable = kit.printers.filter { canPrintOffline($0) }
                ForEach(usable) { p in
                    line(p.name, en: p.usage == "receipt" ? "レシート" : "厨房・\(p.stations.joined(separator: "/"))") {
                        let (text, color) = route(p)
                        Text(text).font(.system(size: 14, weight: .semibold)).foregroundColor(color)
                    }
                }
                if usable.isEmpty && !kit.printers.isEmpty {
                    Text("ネット無しで出せるプリンターはまだありません（Bluetooth でつなぐか、管理画面の「設定 › レジ端末」で LAN を決めると出せます）")
                        .font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.ink3)
                        .padding(.horizontal, 20).padding(.vertical, 10)
                }
            }
            // まだサーバーへ送っていないオフラインの伝票
            if store.pendingCount > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    Text("サーバーへ送っていない伝票 \(store.pendingCount)件").font(.system(size: 14, weight: .heavy)).foregroundColor(NFColor.ink)
                    ForEach(store.orders) { o in
                        HStack(spacing: 6) {
                            Image(systemName: o.syncError == nil ? "clock" : "exclamationmark.triangle.fill")
                                .foregroundColor(o.syncError == nil ? NFColor.ink3 : NFColor.danger)
                            Text("\(o.number)　\(o.tableName ?? "")\(o.checkout != nil ? "　会計済み ¥\(o.checkout!.total)" : "")\(o.syncError.map { "　— \($0)" } ?? "")")
                                .font(.system(size: 13, weight: .semibold)).foregroundColor(o.syncError == nil ? NFColor.ink2 : NFColor.danger)
                                .lineLimit(3)
                            Spacer(minLength: 0)
                            if o.blocked == true || o.syncTries >= 10 {
                                // 人が確かめる伝票：伝票明細（アプリ）で直したら、この iPad の分は消す（Web には行かない。2026-10-25）
                                Button("伝票明細で直したので消す") { discardTarget = o.id }
                                    .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.danger)
                            }
                        }
                    }
                    button("今すぐ送る", icon: "arrow.up.circle", busy: store.syncing, disabled: !net.online) {
                        Task { await store.syncAll(force: true) }
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
            }
            if !store.notes.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("送れたけれど確かめてほしいこと").font(.system(size: 14, weight: .heavy)).foregroundColor(NFColor.ink)
                    ForEach(Array(store.notes.enumerated()), id: \.offset) { _, n in
                        Text(n).font(.system(size: 13, weight: .semibold)).foregroundColor(NFColor.saffron).fixedSize(horizontal: false, vertical: true)
                    }
                    button("確かめたので消す", icon: "checkmark") { store.clearNotes() }
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
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
            line("オフラインを試す", en: "Simulate offline") {
                VStack(alignment: .leading, spacing: 4) {
                    Toggle("", isOn: Binding(get: { net.forcedOffline }, set: { NativeNet.shared.setForcedOffline($0) }))
                        .labelsHidden().tint(NFColor.iris)
                    Text("ON のあいだは回線を切ったときと同じ動きです（注文・会計はこの iPad に保存され、OFF にすると送られて売上に入ります）")
                        .font(.system(size: 12)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
                }
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
            .padding(.horizontal, 20).padding(.vertical, 14)
        }
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NFColor.line, lineWidth: 1))
        .onAppear {
            kit = NativePrintKit.shared.kit
            ready = NativePrintKit.shared.ready
        }
        .alert("この iPad のオフライン伝票を消しますか？", isPresented: Binding(get: { discardTarget != nil }, set: { if !$0 { discardTarget = nil } })) {
            Button("消す", role: .destructive) { if let id = discardTarget { store.discard(id) }; discardTarget = nil }
            Button("キャンセル", role: .cancel) { discardTarget = nil }
        } message: {
            Text("サーバーには入りません。伝票明細・オーダー・会計で品・会計を直してから消してください。")
        }
    }

    /// ネットが無くても出せるか（Bluetooth でつないである／LAN のアドレスがある）
    private func canPrintOffline(_ p: OfflineKit.Printer) -> Bool {
        printConfig.config.appLinks.contains(where: { $0.printerId == p.id }) || p.lan != nil
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
        // 名前は左・状態は右（設定の他の行と同じ）
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 17, weight: .bold)).foregroundColor(NFColor.ink)
                if !en.isEmpty { Text(en).font(.system(size: 12, weight: .medium)).foregroundColor(NFColor.ink3) }
            }
            Spacer(minLength: 16)
            content()
        }
        .padding(.horizontal, 18).padding(.vertical, 7).frame(minHeight: 54)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1).padding(.horizontal, 20) }
    }

    private func button(_ text: String, icon: String? = nil, primary: Bool = false, busy: Bool = false, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(primary ? .white : NFColor.iris).scaleEffect(0.8) }
                else if let icon { Image(systemName: icon) }
                Text(text)
            }
            .font(.system(size: 15.5, weight: .bold))
            .foregroundColor(primary ? .white : NFColor.ink)
            .padding(.horizontal, 18).frame(height: 46)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(primary ? NFColor.iris : Color.white))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(primary ? Color.clear : NFColor.line, lineWidth: 1))
        }
        .buttonStyle(PressableStyle())
        .disabled(disabled || busy)
        .opacity(disabled ? 0.5 : 1)
    }
}
