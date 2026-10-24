import SwiftUI

/// iPhone：はじめに使い方を選ぶ（あとで ≡ の「アプリの使い方を変える」から変えられる）。
/// 2026-10-24 Ronnie「iOS ホーム画面」：日本語を大きく・英語を小さく、ハンディ／オーナーの違いが一目で分かる2枚のカード
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

/// ハンディ：まだログインしていないとき。お店の「ハンディ QR」を読む
struct HandyLoginView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ZStack {
            Brand.background.ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                Image(systemName: "qrcode.viewfinder")
                    .font(.system(size: 72, weight: .regular))
                    .foregroundColor(Brand.purple)
                Text("お店の QR コードを読んでください")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(Brand.ink)
                    .multilineTextAlignment(.center)
                Text("レジの上の「ハンディ QR」を読むと、この iPhone がハンディとしてログインします。\nScan the store's Handy QR to sign in.")
                    .font(.system(size: 13))
                    .foregroundColor(Brand.ink2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
                Button {
                    state.scanning = true
                } label: {
                    Label("QR を読む / Scan", systemImage: "camera.fill")
                        .font(.system(size: 18, weight: .bold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .foregroundColor(.white)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Brand.purple))
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 32)
                .padding(.top, 6)
                Spacer()
                Button("使い方を変える（オーナー・店長）") { state.resetMode() }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(Brand.purple)
                    .padding(.bottom, 18)
            }
            .frame(maxWidth: 520)
        }
    }
}
