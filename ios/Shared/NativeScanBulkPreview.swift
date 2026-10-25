import SwiftUI

// ScanSnap のまとめて取り込みの見本（シミュレーターで形を確かめる用。通信しない）。
// 起動の引数 -tenpoNativePreview scanBulk（iPad。-tenpoNativeLandscape YES で横）| phoneOwnerScanBulk（iPhone）
// 店名・名前はすべて作りもの（実在の人・お店ではありません）。

extension NativeScanBulkModel {
    static func sample() -> NativeScanBulkModel {
        let m = NativeScanBulkModel()
        let opt = { (v: String, l: String) in NSBOption(value: v, label: l) }
        m.info = NSBInfo(
            ok: true,
            storeName: "TENPO ONE 新宿店",
            canAttach: true,
            today: "2026-10-25",
            maxFiles: 50,
            maxBytes: 20 * 1024 * 1024,
            inlineMaxBytes: 3_000_000,
            receiptPayments: [opt("cash", "現金"), opt("card", "クレジットカード"), opt("emoney", "電子マネー"), opt("qr", "QR決済")],
            billPayments: [opt("transfer", "振込"), opt("debit", "口座振替"), opt("card", "クレジットカード"), opt("cash", "現金")],
            categories: [opt("vendor", "仕入・経費"), opt("rent", "家賃"), opt("electric", "電気"), opt("water", "水道"), opt("gas", "ガス")]
        )
        let tx1 = "00000000-0000-4000-8000-000000000101"
        let tx2 = "00000000-0000-4000-8000-000000000102"

        // 1. 現金のレシート：同じ金額の出金が 2 つ（紐付けの案）
        let r1 = NSBReading(kind: "receipt", category: nil, amount: 3280, date: "2026-10-24", vendorName: "まるやま青果", tax: 243, payment: nil)
        let p1 = NSBPlan(
            reading: r1, action: "attach", txId: tx1,
            candidates: [
                NSBCandidate(id: tx1, businessDate: "2026-10-24", amount: 3280, label: "食材（山田 太郎）"),
                NSBCandidate(id: tx2, businessDate: "2026-10-23", amount: 3280, label: "消耗品"),
            ],
            note: "10/24 出金 ¥3,280 に紐付けます", duplicate: nil, canAttach: true
        )
        var row1 = NSBRow(name: "20261025_093012.pdf")
        row1.state = .confirm
        row1.docId = "00000000-0000-4000-8000-000000000201"
        row1.reading = r1
        row1.plan = p1
        row1.choices = [
            NSBChoice(key: tx1, action: "attach", txId: tx1, label: "10/24 の出金 ¥3,280 に紐付け", sub: "食材（山田 太郎）"),
            NSBChoice(key: tx2, action: "attach", txId: tx2, label: "10/23 の出金 ¥3,280 に紐付け", sub: "消耗品"),
            NSBChoice(key: "receipt", action: "receipt", txId: nil, label: "レシートとして保存（出金に紐付けない）", sub: nil),
            NSBChoice(key: "keep", action: "keep", txId: nil, label: "あとで（保存ボックスに残す）", sub: nil),
        ]
        row1.action = "attach"
        row1.txId = tx1
        row1.isPdf = true

        // 2. 電気の請求書（月払い・月次清算）。3 ページの PDF
        let r2 = NSBReading(kind: "bill", category: "electric", amount: 48600, date: "2026-10-20", vendorName: "さくら電力", tax: 4418, payment: "debit")
        let p2 = NSBPlan(reading: r2, action: "bill", txId: nil, candidates: [], note: "月払い：電気料金（月次清算で反映）に入れます", duplicate: nil, canAttach: true)
        var row2 = NSBRow(name: "20261025_093140.pdf")
        row2.state = .confirm
        row2.docId = "00000000-0000-4000-8000-000000000202"
        row2.reading = r2
        row2.plan = p2
        row2.choices = [
            NSBChoice(key: "bill", action: "bill", txId: nil, label: "月払い：電気料金（月次清算で反映）", sub: nil),
            NSBChoice(key: "keep", action: "keep", txId: nil, label: "あとで（保存ボックスに残す）", sub: nil),
        ]
        row2.action = "bill"
        row2.pages = 3
        row2.isPdf = true

        // 3〜6. 済んだもの・取り込まなかったもの・読み取り中・待機中
        var row3 = NSBRow(name: "photo_20261025_093300_1.jpg")
        row3.state = .done
        row3.outcome = NSBOutcome(result: "receipt", label: "コンビニ ¥648（クレジットカード）")
        var row4 = NSBRow(name: "20261024_181005.pdf")
        row4.state = .skipped
        row4.message = "同じファイルが 10/24 に取り込み済みです（保存ボックス）"
        var row5 = NSBRow(name: "20261025_093412.pdf")
        row5.state = .working
        row5.step = "文字を読み取っています"
        let row6 = NSBRow(name: "20261025_093455.pdf")

        m.rows = [row1, row2, row3, row4, row5, row6]
        m.running = true
        m.folderDay = "2026-10-25"
        return m
    }
}

struct NativeScanBulkPreview: View {
    let kind: String
    @StateObject private var model = NativeScanBulkModel.sample()

    var body: some View {
        if kind == "phoneOwnerScanBulk" {
            NativePhoneOwnerScanBulkView(model: model, onBack: {}, onFolder: {})
        } else {
            NativeScanBulkView(model: model, onBack: {})
        }
    }
}
