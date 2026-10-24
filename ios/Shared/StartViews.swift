import SwiftUI

/// iPhone：使い方を選ぶ。**はじめには出さない**（iPhone はいつもハンディから。2026-10-24）。
/// ハンディの Web メニュー「アプリの使い方を変える」か、QR 画面の下の小さな文字を押したときだけ出る
struct ModeChooserView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        VStack(spacing: 22) {
            Spacer()
            Image("BrandMark")
                .resizable()
                .scaledToFit()
                .frame(width: 88, height: 88)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            Text("TENPO ONE")
                .font(.system(size: 28, weight: .heavy))
                .foregroundColor(Brand.ink)
            Text("使い方を選んでください")
                .font(.system(size: 15))
                .foregroundColor(Brand.ink2)

            VStack(spacing: 14) {
                ChoiceButton(
                    title: "ハンディ（スタッフ）",
                    subtitle: "注文・呼び出し・テーブル。お店の QR でログイン",
                    systemImage: "cart.fill",
                    filled: true
                ) { state.choose(.handy) }
                ChoiceButton(
                    title: "オーナー・店長",
                    subtitle: "売上・予約・レジ精算・設定。メールでログイン",
                    systemImage: "chart.bar.xaxis",
                    filled: false
                ) { state.choose(.owner) }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            Spacer()
            Text("Version \(AppConfig.version)")
                .font(.system(size: 11))
                .foregroundColor(Brand.ink2.opacity(0.7))
                .padding(.bottom, 12)
        }
        .frame(maxWidth: 520)
    }
}

private struct ChoiceButton: View {
    let title: String
    let subtitle: String
    let systemImage: String
    let filled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 22, weight: .bold))
                    .frame(width: 30)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.system(size: 18, weight: .bold))
                    Text(subtitle).font(.system(size: 12)).opacity(0.85)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .foregroundColor(filled ? .white : Brand.purple)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(filled ? Brand.purple : Color.white)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(Brand.purple.opacity(filled ? 0 : 0.5), lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
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
                Button("オーナー・店長の方はこちら（アプリの使い方を変える）") { state.resetMode() }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.7))
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)
                    .background(Capsule().fill(Color.white.opacity(0.12)))
                    .padding(.bottom, 14)
            }
            .frame(maxWidth: 520)
        }
        .preferredColorScheme(.dark)
    }
}
