import SwiftUI

/// iPad（レジ）のホーム（ネイティブ）。Airレジのように大きなボタンから選ぶ。
/// 2026-10-13 Ronnie「iPad がアプリらしくない」→「ホームとテーブルの画面もネイティブに」。
/// Order & Pay（テーブル一覧）はネイティブ。それ以外はまだ Web の画面を開く（ホームに戻ると、またこの画面）。
struct NativeHomeView: View {
    @EnvironmentObject var state: AppState
    @State private var clock = Date()
    private let timer = Timer.publish(every: 20, on: .main, in: .common).autoconnect()

    private struct Tile: Identifiable {
        let id: String
        let icon: String
        let title: String
        let sub: String
        let big: Bool
        let action: () -> Void
    }

    private var tiles: [Tile] {
        [
            Tile(id: "order", icon: "fork.knife", title: "Order & Pay", sub: "Tables · オーダー・会計", big: true) {
                AppState.shared.nativeScreen = .floor
            },
            Tile(id: "quick", icon: "bolt.fill", title: "Quick pay", sub: "Takeout · 即会計", big: true) {
                AppState.shared.openWeb("/app/quick-pay")
            },
            Tile(id: "resv", icon: "calendar", title: "Reservations", sub: "店舗台帳", big: false) {
                AppState.shared.openWeb("/app/reservations")
            },
            Tile(id: "cash", icon: "yensign.circle", title: "Register open / close", sub: "レジ開局・精算", big: false) {
                AppState.shared.openWeb("/app/cash")
            },
            Tile(id: "bills", icon: "doc.text", title: "Bills & expenses", sub: "仕入・経費", big: false) {
                AppState.shared.openWeb("/app/expenses")
            },
            Tile(id: "attendance", icon: "clock", title: "Attendance", sub: "勤怠", big: false) {
                AppState.shared.openWeb("/app/attendance")
            },
            Tile(id: "settings", icon: "gearshape", title: "Register settings", sub: "Printers · レジの設定", big: false) {
                AppState.shared.openWeb("/app/pos/settings")
            },
            Tile(id: "menu", icon: "square.grid.2x2", title: "All menus", sub: "メニュー", big: false) {
                AppState.shared.openWeb("/app/menu")
            },
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(
                storeName: state.storeName.isEmpty ? "TENPO ONE" : state.storeName, title: "Home", subtitle: "ホーム",
                userName: NativeFloorView.hm(clock),
                onWeb: { AppState.shared.chooseClassic(path: "/app/dashboard") },
                backText: nil, rightIcon: "clock"
            )
            GeometryReader { geo in
                ScrollView {
                    VStack(spacing: 16) {
                        HStack(spacing: 16) {
                            ForEach(tiles.filter(\.big)) { t in
                                bigTile(t).frame(height: max(220, geo.size.height * 0.42))
                            }
                        }
                        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: 3), spacing: 16) {
                            ForEach(tiles.filter { !$0.big }) { t in
                                smallTile(t)
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .background(NT.page.ignoresSafeArea())
        .onReceive(timer) { _ in clock = Date() }
        .task {
            // 店の名前をまだ知らなければ、テーブル一覧から取る（失敗しても何もしない）
            if state.storeName.isEmpty, let p = try? await NativeAPI.shared.loadFloor() { state.storeName = p.store.name }
        }
    }

    private func bigTile(_ t: Tile) -> some View {
        Button(action: t.action) {
            VStack(alignment: .leading, spacing: 10) {
                Image(systemName: t.icon).font(.system(size: 44, weight: .bold))
                Spacer(minLength: 0)
                Text(t.title).font(.system(size: 34, weight: .heavy))
                Text(t.sub).font(.system(size: 16, weight: .semibold)).opacity(0.75)
            }
            .foregroundColor(.white)
            .padding(26)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(LinearGradient(colors: t.id == "order" ? [NT.purple, NT.purpleDeep] : [NT.header, Color(hex: 0x3A2C57)],
                                         startPoint: .topLeading, endPoint: .bottomTrailing))
            )
        }
        .buttonStyle(PressableStyle(scale: 0.98))
    }

    private func smallTile(_ t: Tile) -> some View {
        Button(action: t.action) {
            HStack(spacing: 14) {
                Image(systemName: t.icon).font(.system(size: 26, weight: .bold)).foregroundColor(NT.purple)
                    .frame(width: 54, height: 54)
                    .background(RoundedRectangle(cornerRadius: 14).fill(NT.lilac))
                VStack(alignment: .leading, spacing: 3) {
                    Text(t.title).font(.system(size: 18, weight: .heavy)).foregroundColor(NT.ink).lineLimit(1).minimumScaleFactor(0.8)
                    Text(t.sub).font(.system(size: 13, weight: .semibold)).foregroundColor(NT.ink3).lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)).foregroundColor(NT.ink3)
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 92)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NT.card))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(NT.lilacLine, lineWidth: 1))
        }
        .buttonStyle(PressableStyle(scale: 0.98))
    }
}
