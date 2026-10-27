import SwiftUI

/// オーダー画面で人数・時間を押したときの「お客様情報」（2026-10-24 Ronnie「manxe ko sign ma click garepaxi start ko gamen ma gayera
/// time etc 変更 garna milne banau」「start ko jastai sabai 変更、same popup」）。来店登録（お客様情報の確定）と同じ画面
/// （NativeSetupSheet の直し）：モード・プラン・時間制・終了前注意・開始時間・人数（男女）・来店経路。保存は visitEdit。
/// この伝票の卓・伝票の中身はフロアの読み込み（part=floor）から探す。
struct NativeOrderGuestInfo: View {
    @ObservedObject var model: NativeOrderModel
    let onClose: () -> Void

    @StateObject private var floor = NativeFloorModel()
    @State private var target: (table: NFTable, order: NFOrder, slip: NFSlip)?
    @State private var problem: String?

    var body: some View {
        NativeModalCard(width: 900) {
            if let t = target {
                NativeSetupSheet(model: floor, table: t.table, edit: NFVisitEdit(order: t.order, slip: t.slip),
                                 onClose: finish, onStarted: { _ in finish() })
            } else {
                VStack(spacing: 14) {
                    if let p = problem {
                        Text(p).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center)
                        Button("閉じる", action: onClose).font(.system(size: 16, weight: .bold)).tint(NFColor.iris)
                    } else {
                        ProgressView("読み込み中…")
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 220)
                .padding(24)
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let orderId = model.orderId else { problem = "この伝票は変更できません"; return }
        // 保存してあるテーブル一覧で先に出す（押した瞬間に出る。裏で読み直す。2026-10-24 Ronnie「every option 取込み nagari」）
        if let saved = NativeDiskCache.load(NFPayload.self, key: "floor") {
            for t in saved.tables {
                if let o = t.order, let s = o.slips.first(where: { $0.id == orderId }) {
                    floor.payload = saved
                    floor.now = Date().timeIntervalSince1970 * 1000
                    target = (t, o, s)
                    break
                }
            }
        }
        do {
            let p = try await NativeAPI.shared.loadFloor(storeId: model.storeId)
            NativeDiskCache.save(p, key: "floor")
            floor.payload = p
            floor.now = p.serverNow
            if target != nil { return }
            for t in p.tables {
                if let o = t.order, let s = o.slips.first(where: { $0.id == orderId }) {
                    target = (t, o, s)
                    return
                }
            }
            problem = "この伝票の卓が見つかりません（テイクアウトなど卓の無い伝票は変更できません）"
        } catch {
            problem = (error as? NativeAPIError)?.message ?? "読み込めませんでした。もう一度お試しください"
        }
    }

    /// 閉じたら伝票を読み直す（人数・席の時間・プランの品が変わっていれば出す）。保存できたときはお知らせも
    private func finish() {
        let saved = floor.toast
        onClose()
        Task {
            await model.reloadOrder()
            if let saved { model.toast = saved }
        }
    }
}
