import SwiftUI

// レシートのプレビューの見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）。
// 起動の引数 -tenpoNativePreview receiptPad（iPad。-tenpoNativeLandscape YES で横向き）｜ phoneOwnerReceipt（iPhone）
// 中身はサーバーの GET ?part=receipt と同じ形（lib/native-modules/receipt.ts の buildNativeReceiptBody で作った見本）。
// 名前・住所・番号はすべて作りもの（実在の人・お店ではありません）。

private let nrSampleJSON = #"""
{
 "ok": true,
 "orderId": "00000000-0000-4000-8000-000000001024",
 "orderNo": "1024",
 "status": "paid",
 "storeName": "TENPO ONE 新宿店",
 "canPrint": true,
 "canRyoshusho": true,
 "printerReady": true,
 "receipt": {
  "isReissue": false,
  "storeName": "TENPO ONE 新宿店",
  "storeAddress": "東京都新宿区新宿2-1-1\nテストビル3F",
  "storePhone": "03-0000-0000",
  "registrationNumber": "T1234567890123",
  "headerMessage": null,
  "footerMessage": null,
  "registerName": "レジ1",
  "tableName": "A-3",
  "staffName": "山田 太郎",
  "guestCount": 3,
  "orderNo": "1024",
  "issuedAt": "2026/10/25 21:42",
  "startedAt": "2026/10/25 19:58",
  "completedAt": "2026/10/25 21:42",
  "lines": [
   {
    "name": "生ビール（中）",
    "quantity": 4,
    "unitPrice": 650,
    "lineTotal": 2600,
    "modifiers": []
   },
   {
    "name": "本日の刺身盛り合わせ",
    "quantity": 1,
    "unitPrice": 1980,
    "lineTotal": 1980,
    "modifiers": []
   },
   {
    "name": "鶏の唐揚げ",
    "quantity": 2,
    "unitPrice": 780,
    "lineTotal": 1560,
    "modifiers": [
     {
      "name": "レモン",
      "price": 0
     }
    ]
   },
   {
    "name": "和牛の炙り",
    "quantity": 1,
    "unitPrice": 2480,
    "lineTotal": 2480,
    "modifiers": []
   },
   {
    "name": "だし巻き玉子",
    "quantity": 1,
    "unitPrice": 680,
    "lineTotal": 680,
    "modifiers": []
   },
   {
    "name": "レモンサワー",
    "quantity": 3,
    "unitPrice": 550,
    "lineTotal": 1650,
    "modifiers": []
   },
   {
    "name": "〆の焼きおにぎり",
    "quantity": 2,
    "unitPrice": 480,
    "lineTotal": 960,
    "modifiers": []
   },
   {
    "name": "ウーロン茶",
    "quantity": 2,
    "unitPrice": 395,
    "lineTotal": 790,
    "modifiers": []
   }
  ],
  "subtotal": 12000,
  "taxRows": [
   {
    "rate": 10,
    "taxable": 12700,
    "tax": 1157
   }
  ],
  "serviceCharge": 0,
  "discount": 500,
  "couponCode": "WELCOME",
  "total": 12700,
  "payments": [
   {
    "label": "現金",
    "amount": 7700
   },
   {
    "label": "クレジット",
    "amount": 5000
   }
  ],
  "tendered": 10000,
  "change": 2300,
  "refundTotal": 0,
  "netPaid": 12700,
  "pointsEarned": 127,
  "pointsUsed": 0,
  "pointBalance": 1840,
  "qrContent": "TENPOONE:1024:1792932120000"
 },
 "invoice": {
  "amount": 12700,
  "tax": 1157,
  "purpose": "飲食代として",
  "invoiceNote": "（適格簡易請求書・登録番号記載）",
  "noStampNote": "※本領収書は押印を省略しております",
  "layout": {
   "width": 1080,
   "height": 539,
   "items": [
    {"kind":"text","x":540,"y":24,"w":260,"h":0,"text":"領 収 書","size":38,"bold":true,"align":"center"},
    {"kind":"text","x":1045,"y":20,"w":400,"h":0,"text":"会計日時 2026/10/25 21:42","size":18,"bold":false,"align":"right"},
    {"kind":"text","x":1045,"y":47,"w":400,"h":0,"text":"No.1024","size":18,"bold":false,"align":"right"},
    {"kind":"text","x":845,"y":100,"w":810,"h":0,"text":"様","size":27,"bold":false,"align":"right"},
    {"kind":"line","x":35,"y":139,"w":820,"h":0,"text":"","size":0,"bold":false,"align":"left"},
    {"kind":"line","x":35,"y":164,"w":1010,"h":0,"text":"","size":0,"bold":false,"align":"left"},
    {"kind":"text","x":50,"y":188,"w":250,"h":0,"text":"領収金額","size":23,"bold":false,"align":"left"},
    {"kind":"text","x":940,"y":180,"w":640,"h":0,"text":"¥12,700−","size":42,"bold":true,"align":"right"},
    {"kind":"text","x":1040,"y":204,"w":100,"h":0,"text":"（税込）","size":17,"bold":false,"align":"right"},
    {"kind":"line","x":35,"y":245,"w":1010,"h":0,"text":"","size":0,"bold":false,"align":"left"},
    {"kind":"text","x":35,"y":267,"w":610,"h":0,"text":"但し 飲食代として","size":20,"bold":false,"align":"left"},
    {"kind":"text","x":1045,"y":269,"w":380,"h":0,"text":"上記正に領収いたしました","size":17,"bold":false,"align":"right"},
    {"kind":"box","x":35,"y":324,"w":140,"h":190,"text":"","size":0,"bold":false,"align":"left"},
    {"kind":"text","x":105,"y":341,"w":128,"h":0,"text":"収入印紙","size":16,"bold":false,"align":"center"},
    {"kind":"text","x":105,"y":365,"w":128,"h":0,"text":"貼付欄","size":16,"bold":false,"align":"center"},
    {"kind":"text","x":105,"y":389,"w":128,"h":0,"text":"（必要時）","size":16,"bold":false,"align":"center"},
    {"kind":"line","x":225,"y":324,"w":305,"h":0,"text":"","size":0,"bold":false,"align":"left"},
    {"kind":"text","x":225,"y":334,"w":65,"h":0,"text":"税率","size":16,"bold":false,"align":"left"},
    {"kind":"text","x":440,"y":334,"w":145,"h":0,"text":"対象額（税込）","size":16,"bold":false,"align":"right"},
    {"kind":"text","x":530,"y":334,"w":90,"h":0,"text":"消費税額","size":16,"bold":false,"align":"right"},
    {"kind":"line","x":225,"y":364,"w":305,"h":0,"text":"","size":0,"bold":false,"align":"left"},
    {"kind":"text","x":225,"y":375,"w":65,"h":0,"text":"10%","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":440,"y":375,"w":145,"h":0,"text":"¥12,700","size":17,"bold":false,"align":"right"},
    {"kind":"text","x":530,"y":375,"w":90,"h":0,"text":"¥1,157","size":17,"bold":false,"align":"right"},
    {"kind":"text","x":225,"y":418,"w":305,"h":0,"text":"お支払方法：現金 / クレジット","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":225,"y":445,"w":305,"h":0,"text":"担当：山田 太郎","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":570,"y":324,"w":385,"h":0,"text":"TENPO ONE 新宿店","size":25,"bold":true,"align":"left"},
    {"kind":"text","x":570,"y":369,"w":385,"h":0,"text":"東京都新宿区新宿2-1-1","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":570,"y":394,"w":385,"h":0,"text":"テストビル3F","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":570,"y":419,"w":385,"h":0,"text":"TEL 03-0000-0000","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":570,"y":444,"w":385,"h":0,"text":"登録番号 T1234567890123","size":17,"bold":false,"align":"left"},
    {"kind":"text","x":570,"y":481,"w":385,"h":0,"text":"（適格簡易請求書・登録番号記載）","size":13,"bold":false,"align":"left"}
   ]
  }
 },
 "ryoshusho": {
  "issued": false,
  "at": null,
  "atLabel": "",
  "count": 0,
  "message": "この伝票の領収書は発行済みです。領収書は一度しか発行できません"
 }
}
"""#

extension NativeReceiptModel {
    /// 見本の伝票（会計済み・現金とクレジット・会員ポイントあり）
    static func sample(tab: NRTab = .receipt, pad: Bool) -> NativeReceiptModel {
        let payload = try? JSONDecoder().decode(NRcptPayload.self, from: Data(nrSampleJSON.utf8))
        return NativeReceiptModel(orderId: payload?.orderId ?? "", tab: tab, fromOrders: true, pad: pad, sample: payload)
    }
}

struct NativeReceiptPreview: View {
    let kind: String
    @StateObject private var pad = NativeReceiptModel.sample(pad: true)
    @StateObject private var phone = NativeReceiptModel.sample(pad: false)

    var body: some View {
        if kind == "phoneOwnerReceipt" {
            NativePhoneOwnerReceiptView(model: phone, onBack: {})
        } else {
            NativeReceiptView(model: pad, onBack: {})
                .statusBarHidden(true)
        }
    }
}
