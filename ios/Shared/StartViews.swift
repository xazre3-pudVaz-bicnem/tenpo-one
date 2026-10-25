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
            NativeLoginBackground(glowAt: UnitPoint(x: 0.5, y: 0.55))
            VStack(spacing: 0) {
                // 上：広告の写真と同じ見出し（2026-10-25 09:39 Ronnie「ログインもあの写真のように」）
                VStack(spacing: 12) {
                    NativeBrandPill(size: 12)
                    NativeCatchTitle(first: "QRを読むだけで、", second: "すぐハンディ。", size: 30)
                    Text("レジ（iPad）の「iPhone ハンディ」の QR を\n下の枠に入れてください")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(NLStyle.sub)
                        .multilineTextAlignment(.center)
                        .lineSpacing(3)
                }
                .padding(.top, 22)
                .padding(.horizontal, 20)

                // 真ん中：カメラ（角の印つきの枠）
                ZStack {
                    QRScannerView(embedded: true, onCode: { code in state.handleScanned(code) })
                        .id(state.handyScanEpoch)
                        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                    ScanCorners()
                        .stroke(NLStyle.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                        .padding(14)
                    if state.handyJoining {
                        VStack(spacing: 10) {
                            ProgressView().tint(.white).scaleEffect(1.3)
                            Text("ログイン中…").font(.system(size: 16, weight: .bold)).foregroundColor(.white)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(Color.black.opacity(0.55)))
                    }
                }
                .frame(width: 280, height: 280)
                .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Color.white.opacity(0.18), lineWidth: 1))
                .shadow(color: .black.opacity(0.35), radius: 24, y: 12)
                .padding(.top, 26)

                // QR が使えなかったとき・Wi-Fi の外でログアウトしたとき
                if let m = state.handyJoinMessage {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 15)).foregroundColor(Color(hex: 0xFFB4B4))
                        Text(m).font(.system(size: 13, weight: .semibold)).foregroundColor(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                        Button { state.handyJoinMessage = nil } label: {
                            Image(systemName: "xmark").font(.system(size: 12, weight: .bold)).foregroundColor(.white.opacity(0.7))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color(hex: 0xC62828).opacity(0.35)))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(hex: 0xFFB4B4).opacity(0.5), lineWidth: 1))
                    .padding(.horizontal, 22)
                    .padding(.top, 18)
                } else {
                    HStack(spacing: 14) {
                        stepChip("1", "QR を読む")
                        stepChip("2", "担当を選ぶ")
                        stepChip("3", "注文")
                    }
                    .padding(.top, 22)
                }

                Spacer(minLength: 12)
                // 下：店長・オーナーは自分の ID（メール）・パスワードで（2026-10-25 Ronnie）。見る画面は役割で決まる
                Button { state.chooseOwnerLogin() } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "person.badge.key.fill").font(.system(size: 18, weight: .bold))
                        VStack(alignment: .leading, spacing: 1) {
                            Text("店長・オーナーの方").font(.system(size: 15, weight: .bold))
                            Text("ID・パスワードでログイン").font(.system(size: 12))
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
                .padding(.horizontal, 22)
                .padding(.bottom, 16)
            }
            .frame(maxWidth: 520)
        }
        .preferredColorScheme(.dark)
    }

    private func stepChip(_ n: String, _ label: String) -> some View {
        HStack(spacing: 6) {
            Text(n).font(.system(size: 12, weight: .black)).foregroundColor(NLStyle.navy)
                .frame(width: 20, height: 20).background(Circle().fill(NLStyle.accent))
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(.white)
        }
    }
}

/// QR の枠の四隅の印
private struct ScanCorners: Shape {
    func path(in rect: CGRect) -> Path {
        let l = min(rect.width, rect.height) * 0.16
        let r: CGFloat = 18
        var p = Path()
        // 左上
        p.move(to: CGPoint(x: rect.minX, y: rect.minY + l))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
        p.addQuadCurve(to: CGPoint(x: rect.minX + r, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.minX + l, y: rect.minY))
        // 右上
        p.move(to: CGPoint(x: rect.maxX - l, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + r), control: CGPoint(x: rect.maxX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + l))
        // 右下
        p.move(to: CGPoint(x: rect.maxX, y: rect.maxY - l))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addQuadCurve(to: CGPoint(x: rect.maxX - r, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.maxX - l, y: rect.maxY))
        // 左下
        p.move(to: CGPoint(x: rect.minX + l, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - r), control: CGPoint(x: rect.minX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - l))
        return p
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
