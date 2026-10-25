import SwiftUI

// iPad のレジのログイン（ネイティブ）。2026-10-25 02:29 Ronnie：
//   「iPad は 企業番号・店舗コード・パスワード だけ。パスワードが合ったらすぐ担当選択 → レジが開く。
//     ログアウトしたら 企業番号・店舗コードはそのまま（固定）、パスワードだけ入れて同じく担当選択。
//     パスワードを忘れた…などは iPad のアプリには書かない。ログイン画面もデザインして」
// サーバー：POST /api/app/v1/register-login（中身は Web の /register-login と同じ loginRegisterDevice。Cookie を返す）
// 店舗コード＝Web の「店舗ユーザー名」（stores.register_username）

struct RegiClerk: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let role: String
}

/// この iPad に覚えておく 企業番号・店舗コード（ログアウトしても消さない）
enum RegiLoginMemory {
    private static let orgKey = "tenpo.regi.orgCode"
    private static let storeKey = "tenpo.regi.storeCode"
    static var orgCode: String {
        get { UserDefaults.standard.string(forKey: orgKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: orgKey) }
    }
    static var storeCode: String {
        get { UserDefaults.standard.string(forKey: storeKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: storeKey) }
    }
    static var remembered: Bool { !orgCode.isEmpty && !storeCode.isEmpty }
    static func forget() {
        UserDefaults.standard.removeObject(forKey: orgKey)
        UserDefaults.standard.removeObject(forKey: storeKey)
    }
}

@MainActor
final class NativeRegiLoginModel: ObservableObject {
    @Published var orgCode = RegiLoginMemory.orgCode
    @Published var storeCode = RegiLoginMemory.storeCode
    @Published var password = ""
    /// 覚えている 企業番号・店舗コードを固定で出す（「変更」で入力に戻す）
    @Published var fixed = RegiLoginMemory.remembered
    @Published var busy = false
    @Published var error: String?
    @Published var storeName: String?
    /// パスワードが合ったあとの担当選択（nil＝まだ）
    @Published var clerks: [RegiClerk]?

    var canSubmit: Bool {
        orgCode.trimmingCharacters(in: .whitespaces).count >= 6 && !storeCode.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !busy
    }

    func submit() async {
        guard canSubmit else { return }
        busy = true
        defer { busy = false }
        error = nil
        var req = URLRequest(url: AppConfig.url("/api/app/v1/register-login"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "orgCode": orgCode.trimmingCharacters(in: .whitespaces),
            "storeUser": storeCode.trimmingCharacters(in: .whitespaces),
            "password": password,
        ])
        do {
            let data = try await NativeAPI.shared.send(req, kickPrint: false)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
            guard json["ok"] as? Bool == true else {
                // Web の文言の「店舗ユーザー名」は、アプリでは「店舗コード」
                error = ((json["error"] as? String) ?? "ログインできませんでした").replacingOccurrences(of: "店舗ユーザー名", with: "店舗コード")
                password = ""
                return
            }
            RegiLoginMemory.orgCode = orgCode.trimmingCharacters(in: .whitespaces)
            RegiLoginMemory.storeCode = storeCode.trimmingCharacters(in: .whitespaces)
            fixed = true
            password = ""
            storeName = (json["store"] as? [String: Any])?["name"] as? String
            let list = (json["clerks"] as? [[String: Any]] ?? []).compactMap { d -> RegiClerk? in
                guard let id = d["id"] as? String, let name = d["name"] as? String else { return nil }
                return RegiClerk(id: id, name: name, role: (d["role"] as? String) ?? "staff")
            }
            clerks = list
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした。お店の Wi-Fi につながっているか確かめてください"
        }
    }
}

struct NativeRegiLoginView: View {
    @EnvironmentObject var state: AppState
    @StateObject private var model = NativeRegiLoginModel()
    @FocusState private var focus: Field?
    enum Field { case org, store, password }
    /// 見本（-tenpoNativePreview regiLogin|regiClerks）
    var preview: String? = nil

    var body: some View {
        ZStack {
            // 広告の写真と同じ地（2026-10-25 09:39 Ronnie「ログインもあの写真のように」）
            NativeLoginBackground(glowAt: UnitPoint(x: 0.5, y: 0.72))
            if let clerks = model.clerks {
                NativeRegiClerkPicker(storeName: model.storeName ?? "", clerks: clerks) { c in
                    state.finishRegiLogin(clerk: c)
                }
                .transition(.opacity)
            } else {
                loginCard.transition(.opacity)
            }
        }
        .environment(\.colorScheme, .light)
        .animation(.easeOut(duration: 0.2), value: model.clerks != nil)
        .onAppear {
            if preview == "regiClerks" {
                model.storeName = "TENPO ONE 新宿店"
                model.clerks = [RegiClerk(id: "1", name: "佐藤", role: "store_manager"), RegiClerk(id: "2", name: "鈴木", role: "assistant_manager"),
                                RegiClerk(id: "3", name: "高橋", role: "staff"), RegiClerk(id: "4", name: "田中", role: "staff"),
                                RegiClerk(id: "5", name: "伊藤", role: "staff"), RegiClerk(id: "6", name: "渡辺", role: "staff")]
                return
            }
            if preview == "regiLogin" { model.orgCode = "184203"; model.storeCode = "shinjuku"; model.fixed = true }
            focus = model.fixed ? .password : .org
        }
    }

    private var loginCard: some View {
        HStack(spacing: 0) {
            // 左：ブランド
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Image("BrandMark").resizable().scaledToFit().frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .shadow(color: .black.opacity(0.25), radius: 10, y: 5)
                    NativeBrandPill(size: 15)
                }
                NativeCatchTitle(first: "レジも売上も、", second: "この1台で。", size: 36, alignment: .leading)
                    .padding(.top, 10)
                Spacer()
                Text("お店の iPad をレジとして使います").font(.system(size: 14, weight: .semibold)).foregroundColor(NLStyle.sub)
                NativeDisplayPairLink() // ディスプレイ端末（KDS・呼び出しモニター）にする（NativeDisplayMode.swift）
            }
            .padding(44)
            .frame(width: 380, alignment: .leading)
            .frame(maxHeight: .infinity)
            // 右：入力
            VStack(alignment: .leading, spacing: 16) {
                Text("ログイン").font(.system(size: 28, weight: .heavy)).foregroundColor(NT.ink)
                if model.fixed {
                    fixedRow("企業番号", model.orgCode)
                    fixedRow("店舗コード", model.storeCode)
                } else {
                    field("企業番号", text: $model.orgCode, placeholder: "6桁の数字", keyboard: .numberPad, which: .org)
                    field("店舗コード", text: $model.storeCode, placeholder: "例：shinjuku", keyboard: .asciiCapable, which: .store)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("パスワード").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
                    SecureField("レジ用パスワード", text: $model.password)
                        .font(.system(size: 20, weight: .semibold))
                        .textContentType(.password)
                        .focused($focus, equals: .password)
                        .submitLabel(.go)
                        .onSubmit { Task { await model.submit() } }
                        .padding(.horizontal, 16).frame(height: 58)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
                        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(focus == .password ? NT.purple : NT.line, lineWidth: focus == .password ? 2 : 1))
                }
                if let e = model.error {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill").foregroundColor(NT.danger)
                        Text(e).font(.system(size: 14, weight: .semibold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Button { Task { await model.submit() } } label: {
                    HStack(spacing: 8) {
                        if model.busy { ProgressView().tint(.white) }
                        Text(model.busy ? "確認中…" : "ログイン").font(.system(size: 20, weight: .heavy))
                    }
                    .foregroundColor(.white).frame(maxWidth: .infinity).frame(height: 62)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(model.canSubmit || model.busy ? NT.purple : NT.ink3))
                }
                .buttonStyle(PressableStyle())
                .disabled(!model.canSubmit)
                .padding(.top, 4)
            }
            .padding(44)
            .frame(width: 520)
            .frame(maxHeight: .infinity)
            .background(Color.white)
        }
        .frame(height: 560)
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .black.opacity(0.3), radius: 30, y: 16)
        .padding(40)
    }

    private func fixedRow(_ label: String, _ value: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink3)
                Text(value).font(.system(size: 20, weight: .heavy)).foregroundColor(NT.ink).monospacedDigit()
            }
            Spacer()
            Image(systemName: "lock.fill").font(.system(size: 14)).foregroundColor(NT.ink3)
        }
        .padding(.horizontal, 16).frame(height: 62)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
        // 長押しで 企業番号・店舗コードを入れ直す（ふだんは固定。店を変えるときだけ）
        .onLongPressGesture(minimumDuration: 1.2) {
            model.fixed = false
            focus = .org
        }
    }

    private func field(_ label: String, text: Binding<String>, placeholder: String, keyboard: UIKeyboardType, which: Field) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink2)
            TextField(placeholder, text: text)
                .font(.system(size: 20, weight: .semibold))
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focus, equals: which)
                .submitLabel(.next)
                .onSubmit { focus = which == .org ? .store : .password }
                .padding(.horizontal, 16).frame(height: 58)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.page))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(focus == which ? NT.purple : NT.line, lineWidth: focus == which ? 2 : 1))
        }
    }
}

/// 担当選択（パスワードが合ったあと。選ぶとレジが開く）
struct NativeRegiClerkPicker: View {
    let storeName: String
    let clerks: [RegiClerk]
    let onPick: (RegiClerk?) -> Void

    var body: some View {
        VStack(spacing: 22) {
            VStack(spacing: 6) {
                Text(storeName).font(.system(size: 16, weight: .bold)).foregroundColor(.white.opacity(0.8))
                Text("担当者を選んでください").font(.system(size: 32, weight: .heavy)).foregroundColor(.white)
                Text("Select staff").font(.system(size: 14, weight: .semibold)).foregroundColor(.white.opacity(0.65))
            }
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 4), spacing: 16) {
                    ForEach(clerks) { c in
                        Button { onPick(c) } label: {
                            VStack(spacing: 10) {
                                Text(String(c.name.prefix(1))).font(.system(size: 30, weight: .heavy)).foregroundColor(.white)
                                    .frame(width: 70, height: 70)
                                    .background(Circle().fill(NT.purple))
                                Text(c.name).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1).minimumScaleFactor(0.7)
                                Text(Self.roleLabel(c.role)).font(.system(size: 12, weight: .semibold)).foregroundColor(NT.ink3)
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 22)
                            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.white))
                            .shadow(color: .black.opacity(0.15), radius: 10, y: 5)
                        }
                        .buttonStyle(PressableStyle(scale: 0.95))
                    }
                }
                .padding(.horizontal, 60).padding(.bottom, 30)
            }
            .frame(maxHeight: 560)
        }
        .padding(.top, 50)
        .onAppear { if clerks.isEmpty { onPick(nil) } }
    }

    static func roleLabel(_ role: String) -> String {
        switch role {
        case "owner": return "オーナー"
        case "area_manager": return "エリアマネージャー"
        case "store_manager": return "店長"
        case "assistant_manager": return "副店長"
        default: return "スタッフ"
        }
    }
}
