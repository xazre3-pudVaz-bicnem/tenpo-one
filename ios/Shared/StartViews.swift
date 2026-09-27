import SwiftUI

/// iPhone：はじめに使い方を選ぶ（あとで Web のメニュー「アプリのモードを変える」から変えられる）
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
