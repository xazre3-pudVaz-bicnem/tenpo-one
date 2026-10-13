import SwiftUI
import UIKit
import WebKit

/// SwiftUI から Web の画面を出す入れ物
struct WebContainer: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> WebViewController {
        WebViewController(startURL: AppState.shared.startURL)
    }

    func updateUIViewController(_ controller: WebViewController, context: Context) {}
}

/// TENPO ONE の Web（https://www.tenpo-one.com）をそのまま動かす画面。
/// アプリだけの機能は JS ブリッジ（window.TenpoNative）で Web から呼ぶ：振動・QR を読む・モードを変える・通知の許可
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    /// いま表示している Web 画面（Push を開く・QR の結果を渡すときに使う）
    static weak var current: WebViewController?

    private let startURL: URL
    private var webView: WKWebView!
    private let errorView = ConnectionErrorView()
    private var lastTokenSentAt: Date?

    init(startURL: URL) {
        self.startURL = startURL
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.965, green: 0.953, blue: 0.984, alpha: 1)

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        // 呼び出しのベル・予約のチャイムを、タップしなくても鳴らせるように
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent =
            "Mobile/15E148 Safari/604.1 TenpoOneApp/\(AppState.shared.userAgentTag)/\(AppConfig.version)"

        let contentController = WKUserContentController()
        contentController.add(WeakScriptMessageHandler(self), name: "tenpo")
        contentController.addUserScript(
            WKUserScript(source: Self.bridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        config.userContentController = contentController

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = AppState.shared.mode != .regi
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
        ])

        errorView.translatesAutoresizingMaskIntoConstraints = false
        errorView.isHidden = true
        errorView.onRetry = { [weak self] in self?.retry() }
        view.addSubview(errorView)
        NSLayoutConstraint.activate([
            errorView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            errorView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            errorView.topAnchor.constraint(equalTo: view.topAnchor),
            errorView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        Self.current = self
        // レジ（iPad）は営業中に画面を消さない
        UIApplication.shared.isIdleTimerDisabled = AppState.shared.mode == .regi

        // レジ（iPad）：入れ直す前のレジ端末の目印を戻してから最初の画面を読む（同じ iPad を新しい端末として数えない）
        let first = PushManager.shared.takePendingURL() ?? startURL
        if AppState.shared.mode == .regi {
            RegisterDeviceKeychain.restore(into: webView.configuration.websiteDataStore.httpCookieStore) { [weak self] in
                DispatchQueue.main.async { self?.load(first) }
            }
        } else {
            load(first)
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Self.current = self
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyPadZoom()
    }

    /// iPad：画面の文字・ボタンを全部少し大きく（2026-10-14 Ronnie「全部少し大きく」。Airレジくらい）。
    /// Safari の「ページの拡大」と同じ（px の大きさも全部そろって大きくなる）。最大 110%。
    /// 拡大しても Web の並び（左のメニューが出る幅 1024px 以上）が変わらない分だけ。縦向きは 100%（今まで通り）
    static func padZoom(forWidth width: CGFloat) -> CGFloat {
        let fit = width / 1040
        return fit <= 1 ? 1 : min(1.1, fit)
    }

    private func applyPadZoom() {
        guard AppConfig.isPad, let webView else { return }
        let zoom = Self.padZoom(forWidth: view.bounds.width)
        if abs(webView.pageZoom - zoom) > 0.001 { webView.pageZoom = zoom }
    }

    func load(_ url: URL) {
        errorView.isHidden = true
        webView.load(URLRequest(url: url))
    }

    private func retry() {
        errorView.isHidden = true
        if let url = webView.url, url.scheme?.hasPrefix("http") == true {
            webView.reload()
        } else {
            load(startURL)
        }
    }

    // MARK: - JS ブリッジ

    /// Web から使えるようにする window.TenpoNative
    private static func bridgeScript() -> String {
        let app = AppConfig.appKind
        let mode = AppState.shared.userAgentTag
        let version = AppConfig.version
        let isPhone = UIDevice.current.userInterfaceIdiom == .phone ? "true" : "false"
        // iPad（レジ）だけ：Bluetooth・USB のレシートプリンター（ios/Shared/BluetoothPrinters.swift）
        let bluetooth = AppConfig.isPad
            ? "bluetooth: { discover: function(maker){ return call('btDiscover', { maker: maker || 'all' }); }, print: function(job){ return call('btPrint', job || {}); } },"
            : ""
        // iPad だけ：ネイティブのオーダー・会計画面（試験中）の ON/OFF（レジの設定に出る）
        let nativePosOn = AppState.shared.nativePosEnabled ? "true" : "false"
        let nativePos = AppConfig.isPad
            ? "nativePos: { enabled: \(nativePosOn), set: function(on){ return call('setNativePos', { on: !!on }).then(function(r){ if (r && r.ok && window.TenpoNative && window.TenpoNative.nativePos) { window.TenpoNative.nativePos.enabled = !!r.enabled; } return r; }); } },"
            : ""
        // iPad だけ：画面の行き先を知らせる（オーダー・会計をネイティブで開くため。Next の画面の切り替えは pushState）
        let routeHook = AppConfig.isPad
            ? "(function(){ var notify = function(){ post({ type: 'route', url: location.href }); }; var wrap = function(n){ var o = history[n]; history[n] = function(){ var r = o.apply(this, arguments); try { notify(); } catch (e) {} return r; }; }; wrap('pushState'); wrap('replaceState'); window.addEventListener('popstate', notify); })();"
            : ""
        return """
        (function(){
          if (window.TenpoNative) return;
          var post = function(m){ try { window.webkit.messageHandlers.tenpo.postMessage(m); } catch (e) {} };
          var seq = 0, waits = {};
          window.__tenpoNativeReply = function(id, res){ var f = waits[id]; if (f) { delete waits[id]; f(res); } };
          var call = function(type, payload){
            return new Promise(function(resolve){
              var id = String(++seq); waits[id] = resolve;
              var m = Object.assign({}, payload || {}); m.type = type; m.reqId = id; post(m);
              setTimeout(function(){ if (waits[id]) { delete waits[id]; resolve({ ok: false, code: 'timeout' }); } }, 30000);
            });
          };
          window.TenpoNative = {
            isApp: true, app: '\(app)', mode: '\(mode)', version: '\(version)', canVibrate: \(isPhone),
            haptic: function(pattern){ post({ type: 'haptic', pattern: pattern || [300] }); return true; },
            scanQR: function(){ post({ type: 'scanQR' }); },
            changeMode: function(){ post({ type: 'changeMode' }); },
            requestPush: function(){ post({ type: 'requestPush' }); },
            \(bluetooth)
            \(nativePos)
          };
          \(routeHook)
          try { document.documentElement.classList.add('tenpo-app'); } catch (e) {}
        })();
        """
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "tenpo", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "haptic":
            let pattern = (body["pattern"] as? [NSNumber])?.map { $0.intValue } ?? [300]
            Haptics.play(pattern: pattern)
        case "scanQR":
            AppState.shared.scanning = true
        case "changeMode":
            AppState.shared.resetMode()
        case "requestPush":
            PushManager.shared.requestAuthorization()
        case "btDiscover":
            let reqId = body["reqId"] as? String ?? ""
            BluetoothPrinters.shared.discover(maker: body["maker"] as? String ?? "all") { [weak self] devices in
                self?.reply(reqId, ["ok": true, "devices": devices])
            }
        case "btPrint":
            let reqId = body["reqId"] as? String ?? ""
            guard let deviceId = body["deviceId"] as? String, let maker = body["maker"] as? String,
                  let b64 = body["data"] as? String, let data = Data(base64Encoded: b64) else {
                reply(reqId, ["ok": false, "code": "bad_request"])
                return
            }
            BluetoothPrinters.shared.print(deviceId: deviceId, maker: maker, via: body["via"] as? String ?? "bluetooth", data: data) { [weak self] ok, code in
                var res: [String: Any] = ["ok": ok]
                if let code { res["code"] = code }
                self?.reply(reqId, res)
            }
        case "setNativePos":
            let reqId = body["reqId"] as? String ?? ""
            AppState.shared.nativePosEnabled = (body["on"] as? Bool) ?? false
            refreshBridgeScript()
            reply(reqId, ["ok": true, "enabled": AppState.shared.nativePosEnabled])
        case "route":
            if let s = body["url"] as? String, let url = URL(string: s) {
                AppState.shared.maybeOpenNativePos(for: url)
            }
            // レジ端末として登録した直後（画面の切り替えだけで読み直さないとき）も目印を残す
            if AppState.shared.mode == .regi {
                RegisterDeviceKeychain.capture(from: webView.configuration.websiteDataStore.httpCookieStore)
            }
        default:
            break
        }
    }

    /// ネイティブの設定を変えたとき、次に読み込む画面のブリッジを作り直す
    private func refreshBridgeScript() {
        let cc = webView.configuration.userContentController
        cc.removeAllUserScripts()
        cc.addUserScript(WKUserScript(source: Self.bridgeScript(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    /// ネイティブの画面を閉じたあと：前の画面へ戻る（無ければホーム）
    func goBackOrHome() {
        webView.evaluateJavaScript("if (history.length > 1) { history.back(); } else { location.href = '/app/dashboard'; }", completionHandler: nil)
    }

    /// Web の Promise に返す（window.__tenpoNativeReply）
    private func reply(_ reqId: String, _ result: [String: Any]) {
        guard !reqId.isEmpty, let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8) else { return }
        let id = reqId.replacingOccurrences(of: "'", with: "")
        webView.evaluateJavaScript("window.__tenpoNativeReply && window.__tenpoNativeReply('\(id)', \(json));", completionHandler: nil)
    }

    /// 端末の通知トークンをサーバーに渡す（ログインしている Web のセッションで送る）
    func sendPushTokenIfNeeded(force: Bool = false) {
        guard let token = PushManager.shared.deviceToken, let url = webView.url, AppConfig.isOwnHost(url) else { return }
        let path = url.path
        guard path.hasPrefix("/app") || path.hasPrefix("/handy") else { return }
        if !force, let last = lastTokenSentAt, Date().timeIntervalSince(last) < 30 * 60 { return }
        lastTokenSentAt = Date()
        let payload: [String: String] = [
            "token": token,
            "app": AppState.shared.userAgentTag,
            "environment": AppConfig.pushEnvironment,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = """
        fetch('/api/native/push-token', { method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(\(json)) }).catch(function(){});
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: - 移動のきまり

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        let scheme = url.scheme?.lowercased() ?? ""

        if ["tel", "mailto", "sms", "line", "maps"].contains(scheme) {
            UIApplication.shared.open(url)
            return decisionHandler(.cancel)
        }
        if ["about", "blob", "data", "javascript"].contains(scheme) {
            return decisionHandler(.allow)
        }
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if AppConfig.isOwnHost(url) {
            if isMainFrame, let other = AppState.shared.redirect(for: url) {
                decisionHandler(.cancel)
                if other.scheme == "about" {
                    webView.loadHTMLString("<html><body style='background:#f6f3fb'></body></html>", baseURL: nil)
                } else {
                    load(other)
                }
                return
            }
            return decisionHandler(.allow)
        }
        // 画面の中の部品（地図・決済の枠など）はそのまま。別のサイトへの移動は Safari で開く
        if !isMainFrame { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if AppState.shared.mode == .regi {
            RegisterDeviceKeychain.capture(from: webView.configuration.websiteDataStore.httpCookieStore)
        }
        errorView.isHidden = true
        if let url = webView.url { AppState.shared.maybeOpenNativePos(for: url) }
        if let url = webView.url, AppConfig.isOwnHost(url) {
            let path = url.path
            if path.hasPrefix("/app") || path.hasPrefix("/handy") {
                // ログインできた画面で、はじめて通知の許可を聞く
                PushManager.shared.requestAuthorizationOnce()
                sendPushTokenIfNeeded()
            }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showErrorIfNeeded(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showErrorIfNeeded(error)
    }

    private func showErrorIfNeeded(_ error: Error) {
        let nsError = error as NSError
        // 自分で止めた移動（別の画面に差し替えた・Safari で開いた）はエラーにしない
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain", nsError.code == 102 { return } // frame load interrupted
        errorView.isHidden = false
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // MARK: - 新しいウィンドウ・ダイアログ

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if AppConfig.isOwnHost(url) {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        presentSafely(alert, fallback: completionHandler)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        presentSafely(alert) { completionHandler(false) }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(alert.textFields?.first?.text) })
        presentSafely(alert) { completionHandler(nil) }
    }

    /// カメラ・マイク（Web の QR 読み取りなど）は自分のサイトだけ許可
    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(AppConfig.ownHosts.contains(origin.host.lowercased()) ? .grant : .deny)
    }

    func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presentSafely(alert, fallback: {})
    }

    private func presentSafely(_ alert: UIAlertController, fallback: @escaping () -> Void) {
        var top: UIViewController = self
        while let presented = top.presentedViewController { top = presented }
        if top.view.window == nil {
            fallback()
            return
        }
        top.present(alert, animated: true)
    }
}

/// WKUserContentController が強く持つので、画面を解放できるように弱く包む
final class WeakScriptMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(_ target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// つながらないときの画面（再読み込みボタン）
final class ConnectionErrorView: UIView {
    var onRetry: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(red: 0.965, green: 0.953, blue: 0.984, alpha: 1)

        let title = UILabel()
        title.text = "つながりません"
        title.font = .systemFont(ofSize: 22, weight: .bold)
        title.textColor = UIColor(red: 0.165, green: 0.129, blue: 0.220, alpha: 1)

        let body = UILabel()
        body.text = "Wi-Fi・インターネットを確かめて、もう一度読み込んでください。\nNo connection. Check Wi-Fi and try again."
        body.numberOfLines = 0
        body.textAlignment = .center
        body.font = .systemFont(ofSize: 14)
        body.textColor = UIColor(red: 0.369, green: 0.329, blue: 0.439, alpha: 1)

        var buttonConfig = UIButton.Configuration.filled()
        buttonConfig.title = "もう一度読み込む / Retry"
        buttonConfig.baseBackgroundColor = UIColor(red: 0.482, green: 0.247, blue: 0.894, alpha: 1)
        buttonConfig.cornerStyle = .large
        buttonConfig.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 28, bottom: 14, trailing: 28)
        let button = UIButton(configuration: buttonConfig)
        button.addAction(UIAction { [weak self] _ in self?.onRetry?() }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, body, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
