import Foundation
import Security
import WebKit

/// レジ端末の目印（Cookie `tenpo_register_device`。lib/store-access.ts の REGISTER_COOKIE）を Keychain にも残す。
/// 2026-10-13 Ronnie「アプリを入れ直したら この端末ではレジを使えません（台数の上限）」。
/// アプリを消して入れ直すと Cookie が消え、同じ iPad が「新しいレジ端末」として数えられて台数を使い切っていた。
/// Keychain はアプリを入れ直しても残るので、起動のときに Cookie が無ければ戻す → 同じ iPad は同じ端末のまま。
/// サーバー・Web の決まり（台数・解除）は変えない。解除された端末はサーバーが「解除」と判断する。
enum RegisterDeviceKeychain {
    static let cookieName = "tenpo_register_device"
    private static let service = "com.tenpoone.app.register-device"
    private static let account = "cookie"

    private struct Saved: Codable {
        let value: String
        let domain: String
        let path: String
    }

    private static func load() -> Saved? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(Saved.self, from: data)
    }

    private static func save(_ s: Saved) {
        guard let data = try? JSONEncoder().encode(s) else { return }
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        // この iPad だけ（バックアップから別の端末に移らない）。ロック中でもレジは動くので、最初のロック解除のあと読める
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func isOwn(_ domain: String) -> Bool {
        let d = domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return AppConfig.ownHosts.contains(d)
    }

    /// Web の画面を読み終えたとき：Cookie にレジ端末の目印があれば Keychain に残す（変わったときだけ）
    static func capture(from store: WKHTTPCookieStore) {
        store.getAllCookies { all in
            guard let c = all.first(where: { $0.name == cookieName && isOwn($0.domain) }), !c.value.isEmpty else { return }
            if load()?.value == c.value { return }
            save(Saved(value: c.value, domain: c.domain, path: c.path))
        }
    }

    /// 起動のとき（最初の画面を読む前）：Cookie が無ければ Keychain から戻す。終わったら completion
    static func restore(into store: WKHTTPCookieStore, completion: @escaping () -> Void) {
        store.getAllCookies { all in
            guard !all.contains(where: { $0.name == cookieName && isOwn($0.domain) }), let s = load() else {
                completion()
                return
            }
            let props: [HTTPCookiePropertyKey: Any] = [
                .name: cookieName,
                .value: s.value,
                .domain: s.domain,
                .path: s.path.isEmpty ? "/" : s.path,
                .secure: "TRUE",
                .expires: Date().addingTimeInterval(365 * 24 * 60 * 60),
                HTTPCookiePropertyKey("HttpOnly"): "TRUE",
                .sameSitePolicy: HTTPCookieStringPolicy.sameSiteLax,
            ]
            guard let cookie = HTTPCookie(properties: props) else {
                completion()
                return
            }
            store.setCookie(cookie) { completion() }
        }
    }
}
