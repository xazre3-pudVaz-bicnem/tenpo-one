import UIKit
import UserNotifications

/// 通知（Push）。お客様の呼び出し・新しい予約を、画面が消えていても 音＋振動 で知らせる。
/// 端末のトークンは Web のセッションで /api/native/push-token に送る（店舗とアカウントに結びつける）。
final class PushManager: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushManager()

    private(set) var deviceToken: String?
    private var pendingURL: URL?
    private let askedKey = "tenpo.push.asked"

    func configure() {
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    /// ログインした画面ではじめて1回だけ聞く
    func requestAuthorizationOnce() {
        if UserDefaults.standard.bool(forKey: askedKey) {
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            return
        }
        UserDefaults.standard.set(true, forKey: askedKey)
        requestAuthorization()
    }

    func requestAuthorization() {
        let options: UNAuthorizationOptions = [.alert, .sound, .badge]
        UNUserNotificationCenter.current().requestAuthorization(options: options) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
        }
    }

    func didRegister(token data: Data) {
        let token = data.map { String(format: "%02x", $0) }.joined()
        let changed = token != deviceToken
        deviceToken = token
        DispatchQueue.main.async { WebViewController.current?.sendPushTokenIfNeeded(force: changed) }
    }

    /// 通知をタップして起動したときの行き先（Web の画面ができたら開く）
    func takePendingURL() -> URL? {
        defer { pendingURL = nil }
        return pendingURL
    }

    // アプリを開いているときも、上に出して音を鳴らす
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound, .badge])
    }

    // 通知をタップしたら、その画面を開く
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        guard let raw = response.notification.request.content.userInfo["url"] as? String,
              let url = URL(string: raw, relativeTo: AppConfig.baseURL)?.absoluteURL,
              AppConfig.isOwnHost(url) else { return }
        DispatchQueue.main.async {
            if let web = WebViewController.current {
                web.load(url)
            } else {
                self.pendingURL = url
            }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        PushManager.shared.configure()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushManager.shared.didRegister(token: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // 通知が使えなくても、アプリはそのまま使える
    }
}
