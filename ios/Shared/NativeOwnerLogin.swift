import SwiftUI

// iPhone の店長・オーナーのログイン（ネイティブ）。2026-10-25 02:29 Ronnie「アプリのログイン画面はそれぞれの形で」。
// ID（メール）・パスワード → POST /api/app/v1/owner-login（Web の /login と同じ signInWithPassword。Cookie を返す）→ /app/dashboard。
// 見る画面はログインした人の役割（店長・エリア・本社）でサーバーが決める。スタッフはお店の QR（下のボタン）

@MainActor
final class NativeOwnerLoginModel: ObservableObject {
    private static let emailKey = "tenpo.owner.email"
    @Published var email = UserDefaults.standard.string(forKey: NativeOwnerLoginModel.emailKey) ?? ""
    @Published var password = ""
    @Published var busy = false
    @Published var error: String?

    var canSubmit: Bool { email.contains("@") && !password.isEmpty && !busy }

    func submit() async -> Bool {
        guard canSubmit else { return false }
        busy = true
        defer { busy = false }
        error = nil
        var req = URLRequest(url: AppConfig.url("/api/app/v1/owner-login"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["email": email.trimmingCharacters(in: .whitespaces), "password": password])
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard json["ok"] as? Bool == true else {
                error = (json["error"] as? String) ?? "ログインできませんでした"
                password = ""
                return false
            }
            UserDefaults.standard.set(email.trimmingCharacters(in: .whitespaces), forKey: Self.emailKey)
            password = ""
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }
}

struct NativeOwnerLoginView: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model = NativeOwnerLoginModel()
    @FocusState private var focus: Field?
    enum Field { case email, password }

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0x171333), Color(hex: 0x1E2A6B), Color(hex: 0x2A6FE6)], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            Circle().fill(Color.white.opacity(0.06)).frame(width: 360).offset(x: 160, y: -320)
            ScrollView {
                VStack(spacing: 0) {
                    VStack(spacing: 12) {
                        Image("BrandMark").resizable().scaledToFit().frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                            .shadow(color: .black.opacity(0.25), radius: 10, y: 5)
                        Text("TENPO ONE").font(.system(size: 30, weight: .heavy)).foregroundColor(.white)
                        Text("店長・オーナー").font(.system(size: 16, weight: .bold)).foregroundColor(.white.opacity(0.8))
                    }
                    .padding(.top, 56).padding(.bottom, 28)
                    VStack(alignment: .leading, spacing: 14) {
                        Text("ログイン").font(.system(size: 22, weight: .heavy)).foregroundColor(NT.ink)
                        input("ID（メールアドレス）", text: $model.email, secure: false, which: .email)
                        input("パスワード", text: $model.password, secure: true, which: .password)
                        if let e = model.error {
                            HStack(alignment: .top, spacing: 6) {
                                Image(systemName: "exclamationmark.circle.fill").foregroundColor(NT.danger)
                                Text(e).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Button { Task { await submit() } } label: {
                            HStack(spacing: 8) {
                                if model.busy { ProgressView().tint(.white) }
                                Text(model.busy ? "確認中…" : "ログイン").font(.system(size: 18, weight: .heavy))
                            }
                            .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 56)
                            .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(model.canSubmit || model.busy ? NT.purple : NT.ink3))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(!model.canSubmit)
                        Text("見られる画面は、アカウントの役割（店長・エリアマネージャー・本社）で決まります")
                            .font(.system(size: 12)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(22)
                    .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Color.white))
                    .shadow(color: .black.opacity(0.25), radius: 20, y: 10)
                    .padding(.horizontal, 20)

                    Button { state.chooseHandyLogin() } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "qrcode.viewfinder").font(.system(size: 20, weight: .bold))
                            VStack(alignment: .leading, spacing: 1) {
                                Text("スタッフの方").font(.system(size: 15, weight: .bold))
                                Text("お店の QR でログイン（ハンディ）").font(.system(size: 12))
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 18).frame(height: 60)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.14)))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color.white.opacity(0.3), lineWidth: 1))
                    }
                    .buttonStyle(PressableStyle())
                    .padding(.horizontal, 20).padding(.top, 22).padding(.bottom, 30)
                }
            }
        }
        .environment(\.colorScheme, .light)
        .onAppear { focus = model.email.isEmpty ? .email : .password }
    }

    private func submit() async {
        if await model.submit() { state.finishOwnerLogin() }
    }

    private func input(_ label: String, text: Binding<String>, secure: Bool, which: Field) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink2)
            Group {
                if secure {
                    SecureField("", text: text).textContentType(.password).submitLabel(.go).onSubmit { Task { await submit() } }
                } else {
                    TextField("name@example.com", text: text).textContentType(.username).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().submitLabel(.next).onSubmit { focus = .password }
                }
            }
            .font(.system(size: 17, weight: .semibold))
            .focused($focus, equals: which)
            .padding(.horizontal, 14).frame(height: 52)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(NT.page))
            .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous).stroke(focus == which ? NT.purple : NT.line, lineWidth: focus == which ? 2 : 1))
        }
    }
}
