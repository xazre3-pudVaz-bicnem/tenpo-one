import SwiftUI

/// iPhone：使い方を選ぶ。**はじめには出さない**（iPhone はいつもハンディから。2026-10-24）。
/// ハンディの Web メニュー「アプリの使い方を変える」か、QR 画面の下の小さな文字を押したときだけ出る
struct ModeChooserView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                Image("BrandMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 84, height: 84)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: Brand.ink.opacity(0.12), radius: 14, y: 6)
                HStack(spacing: 6) {
                    Text("TENPO").font(.system(size: 28, weight: .heavy)).foregroundColor(Brand.purple)
                    Text("ONE").font(.system(size: 28, weight: .heavy)).foregroundColor(Brand.ink)
                }
                .padding(.top, 16)
                Text("使い方を選んでください")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(Brand.ink)
                    .padding(.top, 14)
                Text("Choose how you use this iPhone")
                    .font(.system(size: 12))
                    .foregroundColor(Brand.ink2)
                    .padding(.top, 2)

                VStack(spacing: 12) {
                    ChoiceButton(
                        title: "ハンディ",
                        en: "HANDY · Staff",
                        subtitle: "テーブル・注文・呼び出し・今日の予約。お店の QR でログイン",
                        systemImage: "cart.fill",
                        filled: true
                    ) { state.choose(.handy) }
                    ChoiceButton(
                        title: "オーナー・店長",
                        en: "OWNER · Manager",
                        subtitle: "売上・来店・予約・レジ精算・設定。メールでログイン",
                        systemImage: "chart.bar.xaxis",
                        filled: false
                    ) { state.choose(.owner) }
                }
                .padding(.horizontal, 20)
                .padding(.top, 26)
                Text("あとから ≡ の「アプリの使い方を変える」で切り替えられます")
                    .font(.system(size: 11))
                    .foregroundColor(Brand.ink2)
                    .multilineTextAlignment(.center)
                    .padding(.top, 14)
                    .padding(.horizontal, 28)
                Spacer(minLength: 16)
                Text("Version \(AppConfig.version)")
                    .font(.system(size: 11))
                    .foregroundColor(Brand.ink2.opacity(0.7))
                    .padding(.bottom, 12)
            }
            .frame(maxWidth: 520)
        }
    }
}

private struct ChoiceButton: View {
    let title: String
    let en: String
    let subtitle: String
    let systemImage: String
    let filled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundColor(filled ? Brand.purple : .white)
                    .frame(width: 50, height: 50)
                    .background(Circle().fill(filled ? Color.white : Brand.purple))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 20, weight: .heavy))
                    Text(en).font(.system(size: 11, weight: .bold)).tracking(0.6).opacity(0.8)
                    Text(subtitle).font(.system(size: 12)).opacity(0.85).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 4)
                Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).opacity(0.8)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .foregroundColor(filled ? .white : Brand.ink)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(filled ? Brand.purple : Color.white)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Brand.purple.opacity(filled ? 0 : 0.35), lineWidth: 1.5)
            )
            .shadow(color: Brand.ink.opacity(filled ? 0.18 : 0.06), radius: 12, y: 6)
        }
        .buttonStyle(PressableStyle())
    }
}

/// ハンディ：まだログインしていないとき。**カメラがすぐ開く**ので、お店の「ハンディ QR」を枠に入れるだけでログイン
/// （2026-10-24 Ronnie「アプリを入れて QR でログインしたら、すぐハンディ。ほかは出さない」。
/// 前の「QR を読む」ボタンの画面と「ハンディ／オーナー」を選ぶ画面は、はじめには出さない）
struct HandyLoginView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            QRScannerView(embedded: true, onCode: { code in state.handleScanned(code) })
                .ignoresSafeArea()
            VStack(spacing: 0) {
                // 上：何をするかだけ（日本語を大きく・英語を小さく）
                VStack(spacing: 6) {
                    HStack(spacing: 8) {
                        Image("BrandMark")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 26, height: 26)
                            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        Text("TENPO ONE ハンディ")
                            .font(.system(size: 15, weight: .heavy))
                            .foregroundColor(.white)
                    }
                    Text("お店の「ハンディ QR」を読んでください")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                    Text("レジ（iPad）の「iPhone ハンディ」の QR。読めたらそのままハンディが開きます\nScan the store's Handy QR to sign in.")
                        .font(.system(size: 12))
                        .foregroundColor(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
                .padding(.top, 18)
                .padding(.bottom, 14)
                .frame(maxWidth: .infinity)
                .background(
                    LinearGradient(colors: [.black.opacity(0.75), .black.opacity(0)], startPoint: .top, endPoint: .bottom)
                        .ignoresSafeArea(edges: .top)
                )
                Spacer()
                // 下：オーナー・店長だけが使う小さな文字（スタッフは触らない）
                // 下：店長・オーナーは自分の ID（メール）・パスワードで（2026-10-25 Ronnie）。見る画面は役割で決まる
                Button { state.chooseOwnerLogin() } label: {
                    VStack(spacing: 2) {
                        Text("店長・オーナーの方").font(.system(size: 15, weight: .bold))
                        Text("ID・パスワードでログイン").font(.system(size: 12))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.16)))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.3), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 24)
                .padding(.bottom, 18)
            }
            .frame(maxWidth: 520)
        }
        .preferredColorScheme(.dark)
    }
}

/// 店長・オーナーのログイン画面（Web の /login）の下に重ねる、スタッフ用の「お店の QR でログイン」（2026-10-25 Ronnie）
struct OwnerLoginSwitchBar: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        VStack {
            Spacer()
            Button { state.chooseHandyLogin() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "qrcode.viewfinder").font(.system(size: 18, weight: .bold))
                    VStack(alignment: .leading, spacing: 1) {
                        Text("スタッフの方").font(.system(size: 14, weight: .bold))
                        Text("お店の QR でログイン（ハンディ）").font(.system(size: 11))
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16).frame(height: 56)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0x171333)))
                .shadow(color: .black.opacity(0.2), radius: 8, y: 3)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20).padding(.bottom, 12)
        }
    }
}
