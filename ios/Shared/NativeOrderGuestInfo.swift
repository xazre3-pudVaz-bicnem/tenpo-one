import SwiftUI

/// オーダー画面で人数・時間を押したときの「お客様情報」（2026-10-24 Ronnie「manxe ko sign ma click garepaxi start ko gamen ma gayera
/// time etc 変更 garna milne banau」）。テーブル一覧のポップアップ →「お客様情報」と同じ画面（NativeGuestInfoSheet）を出す：
/// 開始時間・終了予定・人数・モード・プラン・時間・コース。保存は同じ floorSeatTime（Web の setSeatTime）。
/// この伝票の卓・伝票の中身はフロアの読み込み（part=floor）から探す。
struct NativeOrderGuestInfo: View {
    @ObservedObject var model: NativeOrderModel
    let onClose: () -> Void

    @StateObject private var floor = NativeFloorModel()
    @State private var target: (order: NFOrder, slip: NFSlip)?
    @State private var problem: String?

    var body: some View {
        NativeModalCard(width: 720) {
            if let t = target {
                NativeGuestInfoSheet(model: floor, order: t.order, slip: t.slip, onClose: finish)
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
        do {
            let p = try await NativeAPI.shared.loadFloor(storeId: model.storeId)
            floor.payload = p
            floor.now = p.serverNow
            for t in p.tables {
                if let o = t.order, let s = o.slips.first(where: { $0.id == orderId }) {
                    target = (o, s)
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
