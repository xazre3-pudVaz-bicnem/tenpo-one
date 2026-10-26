import Foundation
import Network
import SwiftUI

/// ネットがつながっているか（2026-10-24 Ronnie「net nachale pani sabai kam garna sakne、net chalepaxi afai sync」）。
/// レジの iPad 1台がネット無しでも動くための土台。オンライン/オフラインの切り替わりを画面に知らせる。
@MainActor
final class NativeNet: ObservableObject {
    static let shared = NativeNet()

    /// つながっている（Wi-Fi・モバイル回線のどれかで外へ出られる）
    @Published private(set) var online = true
    /// 最後にオフラインからオンラインに戻った時刻（同期のきっかけ）
    @Published private(set) var cameBackAt: Date?

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "tenpo.net")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let ok = path.status == .satisfied
            Task { @MainActor in self?.set(ok) }
        }
        monitor.start(queue: queue)
    }

    /// 回線そのものがつながっているか
    private var pathOK = true
    /// 設定の「オフラインを試す」（回線を切らずにオフラインの動きを確かめる。アプリを閉じると戻る）
    @Published private(set) var forcedOffline = false

    func setForcedOffline(_ on: Bool) {
        forcedOffline = on
        set(pathOK)
    }

    private func set(_ ok: Bool) {
        pathOK = ok
        let next = ok && !forcedOffline
        guard next != online else { return }
        online = next
        if next { cameBackAt = Date() }
    }

    /// 通信の失敗がネット無しのせいか（URLError のつながらない系）
    static func isOfflineError(_ error: Error) -> Bool {
        guard let e = error as? URLError else { return false }
        switch e.code {
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost,
             .timedOut, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed:
            return true
        default:
            return false
        }
    }
}

/// サーバーの返事をそのまま iPad に保存する（次に開くときは保存したものを先に出し、裏で読み直す。
/// ネットが無いときもこれで画面が出る）。Application Support/tenpo-cache/<key>.json
enum NativeDiskCache {
    private static var dir: URL {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        let d = base.appendingPathComponent("tenpo-cache", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    private static func url(_ key: String) -> URL {
        let safe = key.replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        return dir.appendingPathComponent("\(safe).json")
    }

    static func save(_ data: Data, key: String) {
        try? data.write(to: url(key), options: .atomic)
    }

    static func save<T: Encodable>(_ value: T, key: String) {
        if let data = try? JSONEncoder().encode(value) { save(data, key: key) }
    }

    static func load(_ key: String) -> Data? {
        try? Data(contentsOf: url(key))
    }

    static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        guard let data = load(key) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    static func remove(_ key: String) {
        try? FileManager.default.removeItem(at: url(key))
    }

    /// 古い伝票の保存を消す（伝票ごとの保存がたまらないように。3日より前）
    static func sweep(prefix: String, olderThan seconds: TimeInterval = 3 * 24 * 3600) {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let limit = Date().addingTimeInterval(-seconds)
        for f in files where f.lastPathComponent.hasPrefix(prefix) {
            let d = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if d < limit { try? fm.removeItem(at: f) }
        }
    }
}

/// 画面の上に出す「オフライン」の帯（ネットが戻ったら消える）
struct NativeOfflineBanner: View {
    @ObservedObject private var net = NativeNet.shared
    @ObservedObject private var store = NativeOfflineStore.shared

    var body: some View {
        Group {
            if net.online && (store.pendingCount > 0 || !store.notes.isEmpty) {
                // ネットが戻った：オフラインの伝票を送っている／送れなかった／送れたけれど確かめてほしい
                let problem = store.hasProblems || !store.notes.isEmpty
                HStack(spacing: 8) {
                    Image(systemName: problem ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath").font(.system(size: 14, weight: .bold))
                    Text(store.hasProblems ? "送れなかったオフラインの伝票があります（設定 > プリンター・印刷 > ネットが無いときの印刷）"
                         : !store.notes.isEmpty ? "オフラインの伝票を送りました。確かめてほしいことがあります（設定 > プリンター・印刷 > ネットが無いときの印刷）"
                         : "オフラインの伝票 \(store.pendingCount)件をサーバーへ送っています…")
                        .font(.system(size: 14, weight: NT.strong)).lineLimit(1).minimumScaleFactor(0.7)
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(Capsule().fill(problem ? Color(hex: 0xB7791F) : Color(hex: 0x1A5AD6)))
                .shadow(color: .black.opacity(0.2), radius: 8, y: 3)
                .padding(.top, 6)
                .allowsHitTesting(false)
            } else if !net.online {
                HStack(spacing: 8) {
                    Image(systemName: "wifi.slash").font(.system(size: 14, weight: .bold))
                    Text("オフライン（ネット無し）").font(.system(size: 14, weight: NT.strong))
                    Text(store.pendingCount > 0 ? "この iPad に \(store.pendingCount)件 保存中。ネットが戻ると自動で送ります" : "注文・現金会計・印刷はこの iPad でできます。ネットが戻ると自動で送ります")
                        .font(.system(size: 12, weight: .semibold)).opacity(0.9)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(Capsule().fill(Color(hex: 0xC62828)))
                .shadow(color: .black.opacity(0.2), radius: 8, y: 3)
                .padding(.top, 6)
                .transition(.move(edge: .top).combined(with: .opacity))
                .allowsHitTesting(false)
            }
        }
        .animation(.easeOut(duration: 0.2), value: net.online)
        .animation(.easeOut(duration: 0.2), value: store.pendingCount)
    }
}
