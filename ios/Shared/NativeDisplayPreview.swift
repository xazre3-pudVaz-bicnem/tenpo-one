import SwiftUI

// ディスプレイ端末の画面の見本（-tenpoNativePreview displaySettings|displayCall|displayKitchen|displayNotice|displayPair。
// iPad は -tenpoNativeLandscape YES も）。通信はしない。名前はすべて作りもの。

struct NativeDisplayPreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "displaySettings": NDSSettingsPreview()
        case "displayCall": NativeDisplayScreen(preview: NDSSample.call)
        case "displayKitchen": NativeDisplayScreen(preview: NDSSample.kitchen)
        case "displayNotice": NativeDisplayScreen(preview: NDSSample.notice)
        default: NativeDisplayPairView(preview: true)
        }
    }
}

private struct NDSSettingsPreview: View {
    @StateObject private var model = NativeDisplayDevicesModel.previewSample()
    var body: some View { NativeDisplayDevicesView(model: model, onBack: {}) }
}

extension NativeDisplayDevicesModel {
    static func previewSample() -> NativeDisplayDevicesModel {
        let m = NativeDisplayDevicesModel()
        m.payload = NDSSample.settings
        m.qr = NDVIssuedQr(url: "https://tenpo-one.example/display-pair#" + String(repeating: "a1", count: 24), expiresAt: Date().addingTimeInterval(245))
        return m
    }
}

enum NDSSample {
    static func iso(minutesAgo: Double) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutesAgo * 60))
    }

    static let store = NFNamed(id: "s1", name: "TENPO ONE 新宿店")

    static var settings: NDVPayload {
        NDVPayload(
            store: store,
            canEdit: true,
            flagOn: true,
            flagMessage: nil,
            notReady: false,
            pairBase: "https://tenpo-one.example/display-pair#",
            kinds: [NSTLabeled(id: "kitchen", label: "キッチンディスプレイ"), NSTLabeled(id: "call", label: "呼び出しモニター")],
            stations: [
                NSTLabeled(id: "kitchen", label: "キッチン"), NSTLabeled(id: "grill", label: "焼き場"),
                NSTLabeled(id: "drink", label: "ドリンク"), NSTLabeled(id: "dessert", label: "デザート"),
            ],
            devices: [
                NDVDevice(id: "d1", name: "厨房モニター", kind: "kitchen", kindLabel: "キッチンディスプレイ", stations: [], stationsLabel: "すべて", status: "active",
                          pairedAt: iso(minutesAgo: 4_320), lastSeenAt: iso(minutesAgo: 1), pairedIp: "203.0.113.10", lastIp: "203.0.113.10", userAgent: nil, deviceModel: "iPad · iPadOS 17.5"),
                NDVDevice(id: "d2", name: "受け渡し口", kind: "call", kindLabel: "呼び出しモニター", stations: [], stationsLabel: "すべて", status: "active",
                          pairedAt: iso(minutesAgo: 2_880), lastSeenAt: iso(minutesAgo: 0.5), pairedIp: "203.0.113.10", lastIp: "203.0.113.10", userAgent: nil, deviceModel: "Android TV 11"),
                NDVDevice(id: "d3", name: "ドリンク場", kind: "kitchen", kindLabel: "キッチンディスプレイ", stations: ["drink"], stationsLabel: "ドリンク", status: "active",
                          pairedAt: iso(minutesAgo: 1_440), lastSeenAt: iso(minutesAgo: 130), pairedIp: "203.0.113.10", lastIp: nil, userAgent: nil, deviceModel: "Windows"),
                NDVDevice(id: "d4", name: "古いタブレット", kind: "kitchen", kindLabel: "キッチンディスプレイ", stations: [], stationsLabel: "すべて", status: "revoked",
                          pairedAt: iso(minutesAgo: 20_000), lastSeenAt: nil, pairedIp: nil, lastIp: nil, userAgent: nil, deviceModel: "端末の種類 不明"),
            ]
        )
    }

    private static let settingsKds = NKSettings(warn1: 10, warn2: 15, warn3: 25, aggregate: false, sound: false)

    static var kitchen: NDSPayload {
        let groups = [
            NKGroup(orderId: "o1", orderNo: 101, tableName: "A1", orderSource: "pos", orderTime: iso(minutesAgo: 18), items: [
                NKItem(id: "i1", name: "バターチキンカレー", quantity: 2, memo: nil, modifiers: [NKModifier(name: "大盛り", price: 100)], station: "kitchen", kitchenStatus: "preparing", createdAt: iso(minutesAgo: 18)),
                NKItem(id: "i2", name: "チーズナン", quantity: 2, memo: "よく焼き", modifiers: [], station: "grill", kitchenStatus: "pending", createdAt: iso(minutesAgo: 18)),
                NKItem(id: "i3", name: "マンゴーラッシー", quantity: 1, memo: nil, modifiers: [], station: "drink", kitchenStatus: "ready", createdAt: iso(minutesAgo: 18)),
            ]),
            NKGroup(orderId: "o2", orderNo: 102, tableName: "B3", orderSource: "qr", orderTime: iso(minutesAgo: 11), items: [
                NKItem(id: "i4", name: "タンドリーチキン", quantity: 1, memo: nil, modifiers: [], station: "grill", kitchenStatus: "preparing", createdAt: iso(minutesAgo: 11)),
                NKItem(id: "i5", name: "生ビール", quantity: 3, memo: nil, modifiers: [], station: "drink", kitchenStatus: "pending", createdAt: iso(minutesAgo: 11)),
            ]),
            NKGroup(orderId: "o3", orderNo: 103, tableName: nil, orderSource: "pos", orderTime: iso(minutesAgo: 4), items: [
                NKItem(id: "i6", name: "サモサ", quantity: 2, memo: nil, modifiers: [], station: "kitchen", kitchenStatus: "pending", createdAt: iso(minutesAgo: 4)),
                NKItem(id: "i7", name: "ガジャルハルワ", quantity: 1, memo: nil, modifiers: [], station: "dessert", kitchenStatus: "pending", createdAt: iso(minutesAgo: 4)),
            ]),
        ]
        return NDSPayload(
            ok: true, screen: "board", notice: nil, refreshSec: 8, heartbeat: true, now: Date().timeIntervalSince1970 * 1000,
            store: store,
            device: NDSDevice(id: "d1", name: "厨房モニター", kind: "kitchen", kindLabel: "キッチンディスプレイ", stations: [], stationsLabel: "すべて"),
            kitchen: NDSKitchen(groups: groups, unservedCount: 6, avgElapsedMinutes: 11, kdsSettings: settingsKds, stationOptions: ["all", "kitchen", "grill", "drink", "dessert"]),
            call: nil
        )
    }

    static var call: NDSPayload {
        let cooking = [105, 106, 108, 110, 111].enumerated().map { i, n in
            NDSCallEntry(orderId: "c\(n)", orderNo: n, tableName: i == 1 ? "テイクアウト" : nil, since: iso(minutesAgo: Double(12 - i * 2)))
        }
        let ready = [
            NDSCallEntry(orderId: "r104", orderNo: 104, tableName: nil, since: iso(minutesAgo: 0.1)),
            NDSCallEntry(orderId: "r102", orderNo: 102, tableName: "テイクアウト", since: iso(minutesAgo: 3)),
            NDSCallEntry(orderId: "r101", orderNo: 101, tableName: nil, since: iso(minutesAgo: 6)),
        ]
        return NDSPayload(
            ok: true, screen: "board", notice: nil, refreshSec: 5, heartbeat: true, now: Date().timeIntervalSince1970 * 1000,
            store: store,
            device: NDSDevice(id: "d2", name: "受け渡し口", kind: "call", kindLabel: "呼び出しモニター", stations: [], stationsLabel: "すべて"),
            kitchen: nil,
            call: NDSCall(cooking: cooking, ready: ready)
        )
    }

    static var notice: NDSPayload {
        NDSPayload(
            ok: true, screen: "notice",
            notice: NDSNotice(
                icon: "network",
                title: "お店の回線につないでください",
                body: "この端末をお店のWi-Fi・有線につなぐと、自動で元の画面に戻ります。\n（ログアウト・解除はしていません）",
                footer: "TENPO ONE 新宿店・受け渡し口"
            ),
            refreshSec: 15, heartbeat: true, now: Date().timeIntervalSince1970 * 1000,
            store: store, device: nil, kitchen: nil, call: nil
        )
    }
}
