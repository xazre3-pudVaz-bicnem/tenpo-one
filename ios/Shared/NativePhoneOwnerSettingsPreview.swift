import SwiftUI

// iPhone の店長・オーナー：設定・スタッフ管理・キッチン・店舗日次締め・返金の見本（シミュレーターで形を確かめる・画面写真用。ログインなし・通信なし）
//   -tenpoNativePreview phoneOwnerSettings（設定の入口）| phoneOwnerSettingsMenu（メニュー）| phoneOwnerSettingsHours（営業時間）
//                       phoneOwnerSettingsPayments（決済・端末）| phoneOwnerStaff（スタッフ管理）| phoneOwnerKitchen（キッチン）
//                       phoneOwnerStoreDay（店舗日次締め）| phoneOwnerRefund（返金・取消）
// 名前・店舗はすべて作りもの（実在の人・お店ではない）

struct NativePhoneOwnerSettingsPreview: View {
    let kind: String

    var body: some View {
        switch kind {
        case "phoneOwnerSettingsMenu":
            NPSMenuItemsPage(mode: .menu, backLabel: "設定", onBack: {}, model: NPSSample.menu())
        case "phoneOwnerSettingsHours":
            NPSHoursPage(backLabel: "設定", onBack: {}, model: NPSSample.hours())
        case "phoneOwnerSettingsPayments":
            NPSPaymentsPage(backLabel: "設定", onBack: {}, model: NPSSample.payments())
        case "phoneOwnerStaff":
            NPSStaffPage(backLabel: "ホーム", onBack: {}, model: NPSSample.staff())
        case "phoneOwnerKitchen":
            NPSKitchenPreview()
        case "phoneOwnerStoreDay":
            NOMStoreDaySheet(focus: .close, onClose: {}, onOpen: { _ in }, sample: NPSSample.storeDay())
        case "phoneOwnerRefund":
            NPSRefundPreview()
        default:
            NPSHubView(model: NPSSample.hub(), onBack: {}, onOpen: { _ in })
        }
    }
}

private struct NPSKitchenPreview: View {
    @StateObject private var model = NPSSample.kitchen()
    var body: some View { NativePhoneOwnerKitchenView(model: model, onBack: {}) }
}

private struct NPSRefundPreview: View {
    @StateObject private var model = NPSSample.refund()
    var body: some View {
        if let d = model.detail {
            NPORefundSheet(model: model, detail: d, onClose: {}, onDone: { _ in })
        }
    }
}

/// 見本のデータ（JSON はサーバーの返事と同じ形）
enum NPSSample {
    static let store = #"{"id":"00000000-0000-4000-8000-00000000a001","name":"TENPO ONE 新宿店"}"#

    static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
        do { return try JSONDecoder().decode(T.self, from: Data(json.utf8)) } catch {
            print("NPSSample decode \(T.self): \(error)")
            return nil
        }
    }

    static func iso(minutesAgo: Double) -> String { ISO8601DateFormatter().string(from: Date().addingTimeInterval(-minutesAgo * 60)) }

    @MainActor static func hub() -> NPSHubModel {
        let m = NPSHubModel()
        m.payload = decode(NPSHubPayload.self, """
        {"store":\(store),
         "sections":[
          {"id":"menu","title":"メニュー","en":"Menu","links":[
            {"id":"sold-out","title":"品切れ（売切・販売再開）","description":"","url":"/app/pos/sold-out","allowed":true,"hint":null},
            {"id":"menu-items","title":"商品の追加・編集","description":"","url":"/app/settings/menu","allowed":true,"hint":null}]},
          {"id":"handy","title":"ハンディ・担当者","en":"Handy","links":[
            {"id":"handy-qr","title":"iPhoneハンディ（QRでログイン）","description":"","url":"/app/settings/handy-qr","allowed":true,"hint":null}]}
         ],
         "hubs":[
          {"label":"店舗","en":"Store","href":"/app/settings/store","children":[
            {"href":"/app/settings/store","label":"店舗情報","en":"Store","description":""},
            {"href":"/app/settings/clerks","label":"POS担当者","en":"Clerks","description":""},
            {"href":"/app/settings/tables/qr-print","label":"テーブルQRコード","en":"TableCode","description":""},
            {"href":"/app/settings/hours","label":"営業時間・休業日","en":"Hours","description":""},
            {"href":"/app/settings/company","label":"企業情報","en":"Company","description":""}]},
          {"label":"メニュー","en":"Menu","href":"/app/settings/menu","children":[
            {"href":"/app/settings/menu","label":"メニュー","en":"Menu","description":""},
            {"href":"/app/settings/plans","label":"プラン","en":"Plans","description":""},
            {"href":"/app/settings/options","label":"オプション","en":"Options","description":""},
            {"href":"/app/settings/categories","label":"カテゴリ","en":"Categories","description":""},
            {"href":"/app/settings/menu-book","label":"メニューブック","en":"Menu book","description":""},
            {"href":"/app/settings/qr-service","label":"QRのサービス","en":"QR service","description":""},
            {"href":"/app/settings/menu-bulk","label":"一括編集","en":"Bulk edit","description":""}]},
          {"label":"デバイス管理","en":"Devices","href":"/app/pos/settings","children":[
            {"href":"/app/pos/settings","label":"レジの設定","en":"Register settings","description":""},
            {"href":"/app/settings/printers","label":"ハードウェア","en":"Hardware","description":""},
            {"href":"/app/settings/handy-qr","label":"iPhoneハンディ","en":"Handy QR","description":""},
            {"href":"/app/settings/handy","label":"ハンディ端末","en":"Handy devices","description":""}]},
          {"label":"予約・顧客","en":"Booking","href":"/app/settings/reservation-book","children":[
            {"href":"/app/settings/reservation-book","label":"予約台帳設定","en":"Reservation book","description":""},
            {"href":"/app/settings/booking","label":"予約受付ルール","en":"Booking rules","description":""},
            {"href":"/app/settings/tables","label":"テーブル・フロア","en":"Tables","description":""},
            {"href":"/app/staff","label":"スタッフ・権限","en":"Staff","description":""}]},
          {"label":"会計","en":"Payments","href":"/app/settings/payments","children":[
            {"href":"/app/settings/payments","label":"決済・端末","en":"Payments","description":""},
            {"href":"/app/settings/tax","label":"税率","en":"Tax","description":""},
            {"href":"/app/settings/approvals","label":"承認ルール","en":"Approvals","description":""}]},
          {"label":"運用・管理","en":"Operations","href":"/app/settings/loyalty","children":[
            {"href":"/app/settings/loyalty","label":"会員・ポイント","en":"Loyalty","description":""},
            {"href":"/app/settings/alerts","label":"異常検知の閾値","en":"Alerts","description":""},
            {"href":"/app/settings/import","label":"データ取込","en":"Import","description":""},
            {"href":"/app/settings/integrations","label":"連携","en":"Integrations","description":""},
            {"href":"/app/settings/audit","label":"監査ログ","en":"Audit log","description":""}]}
         ]}
        """)
        return m
    }

    @MainActor static func menu() -> NativeMenuItemsModel {
        let m = NativeMenuItemsModel(mode: .menu)
        func item(_ id: String, _ cat: String, _ name: String, _ en: String, _ type: String, _ price: Int, soldOut: Bool = false, hidden: Bool = false, shared: Bool = false, takeout: Int? = nil) -> String {
            #"{"id":"\#(id)","categoryId":"\#(cat)","name":"\#(name)","nameEn":"\#(en)","nameKana":"","description":"","itemType":"\#(type)","price":\#(price),"takeoutPrice":\#(takeout.map(String.init) ?? "null"),"cost":null,"taxRateId":null,"durationMinutes":null,"sellStartTime":null,"sellEndTime":null,"sortOrder":1,"status":"\#(hidden ? "hidden" : "active")","isSoldOut":\#(soldOut),"pricePending":false,"shared":\#(shared)}"#
        }
        let items = [
            item("m1", "c1", "鶏の唐揚げ", "Fried chicken", "food", 680, takeout: 650),
            item("m2", "c1", "だし巻き玉子", "Rolled omelette", "food", 580),
            item("m3", "c1", "季節の天ぷら盛り合わせ", "Tempura", "food", 1280, soldOut: true),
            item("m4", "c2", "生ビール（中）", "Draft beer", "drink", 650, shared: true),
            item("m5", "c2", "レモンサワー", "Lemon sour", "drink", 550),
            item("m6", "c2", "期間限定 梅酒", "Plum wine", "drink", 600, hidden: true),
        ].joined(separator: ",")
        m.payload = decode(NMIPayload.self, """
        {"store":\(store),"canEdit":true,
         "categories":[{"id":"c1","name":"フード","sortOrder":1},{"id":"c2","name":"ドリンク","sortOrder":2}],
         "taxRates":[{"id":"t1","name":"標準 10%"},{"id":"t2","name":"軽減 8%"}],
         "items":[\(items)]}
        """)
        return m
    }

    @MainActor static func hours() -> NativeHoursModel {
        let m = NativeHoursModel()
        let p = decode(NHRPayload.self, """
        {"store":\(store),"canEdit":true,
         "hours":[
          {"dayOfWeek":0,"isClosed":true,"openTime":null,"closeTime":null,"lastEntryTime":null},
          {"dayOfWeek":1,"isClosed":false,"openTime":"17:00","closeTime":"24:00","lastEntryTime":"23:00"},
          {"dayOfWeek":2,"isClosed":false,"openTime":"17:00","closeTime":"24:00","lastEntryTime":"23:00"},
          {"dayOfWeek":3,"isClosed":false,"openTime":"17:00","closeTime":"24:00","lastEntryTime":"23:00"},
          {"dayOfWeek":4,"isClosed":false,"openTime":"17:00","closeTime":"24:00","lastEntryTime":"23:00"},
          {"dayOfWeek":5,"isClosed":false,"openTime":"17:00","closeTime":"26:00","lastEntryTime":"25:00"},
          {"dayOfWeek":6,"isClosed":false,"openTime":"16:00","closeTime":"26:00","lastEntryTime":"25:00"}],
         "lunchUntil":"15:00","nextFloat":30000,
         "holidays":[{"id":"h1","holidayDate":"\(NOS.addDays(NOS.str(Date()), 9))","name":"店内改装","isTemporary":true}]}
        """)
        m.payload = p
        m.hours = p?.hours ?? []
        m.lunchUntil = p?.lunchUntil ?? "15:00"
        m.nextFloatText = p?.nextFloat.map { String($0) } ?? ""
        return m
    }

    @MainActor static func payments() -> NativePaymentsModel {
        let m = NativePaymentsModel()
        if let p = decode(NPYPayload.self, """
        {"store":\(store),"canEdit":true,"canEditStera":true,"stripe":{"configured":true,"testMode":true},
         "discountKinds":[{"id":"manual","label":"金額を入力"},{"id":"percent","label":"％引き"},{"id":"yen","label":"円引き"}],
         "methods":[{"id":"credit","label":"クレジット"},{"id":"qr","label":"QR"},{"id":"emoney","label":"電子マネー"},{"id":"external","label":"外部端末"}],
         "presets":{"discounts":[{"key":"disc1","name":"幹事様無料","kind":"manual","value":0},{"key":"disc2","name":"学生10%引き","kind":"percent","value":10}],
                    "pointBrands":[{"key":"pt1","name":"ホットペッパー"}],
                    "methodBrands":{"credit":[{"key":"visa","name":"VISA"},{"key":"master","name":"Mastercard"},{"key":"jcb","name":"JCB"}],
                                    "qr":[{"key":"paypay","name":"PayPay"}],"emoney":[{"key":"transit","name":"交通系IC"}],"external":[]}},
         "stera":{"serverUrl":"https://example.com","terminals":[{"id":"s1","name":"レジ横 stera","terminalNo":"0012","linkCode":"ABCD2345EFGH","active":true,"online":true,"lastSeenLabel":"たった今","appVersion":"1.4.0"}]},
         "readers":[],
         "booking":{"mode":"onsite","depositAmount":0,"modes":[{"id":"onsite","label":"現地払い"},{"id":"full","label":"全額決済"},{"id":"deposit","label":"予約金"}]}}
        """) {
            m.payload = p
            m.loaded(p)
        }
        return m
    }

    @MainActor static func staff() -> NativeStaffModel {
        let m = NativeStaffModel()
        if let p = decode(NSFPayload.self, """
        {"store":\(store),"organizationName":"株式会社テンポワン","selfProfileId":"u1",
         "roles":[{"id":"org_owner","label":"オーナー","assignable":false,"hq":true},{"id":"store_manager","label":"店長","assignable":true,"hq":false},
                  {"id":"assistant_manager","label":"副店長","assignable":true,"hq":false},{"id":"staff","label":"スタッフ","assignable":true,"hq":false}],
         "stores":[{"id":"00000000-0000-4000-8000-00000000a001","name":"TENPO ONE 新宿店"},{"id":"00000000-0000-4000-8000-00000000a002","name":"TENPO ONE 渋谷店"}],
         "statuses":[{"id":"active","label":"有効"},{"id":"invited","label":"招待中"},{"id":"suspended","label":"利用停止"}],
         "rows":[
          {"membershipId":"m1","profileId":"u1","displayName":"山田 太郎","displayNameKana":"やまだ たろう","role":"org_owner","roleLabel":"オーナー","status":"active","storeIds":[],"storeNames":[],"hasPin":true,"canEdit":false},
          {"membershipId":"m2","profileId":"u2","displayName":"佐藤 花子","displayNameKana":"さとう はなこ","role":"store_manager","roleLabel":"店長","status":"active","storeIds":["00000000-0000-4000-8000-00000000a001"],"storeNames":["TENPO ONE 新宿店"],"hasPin":true,"canEdit":true},
          {"membershipId":"m3","profileId":"u3","displayName":"鈴木 一郎","displayNameKana":null,"role":"staff","roleLabel":"スタッフ","status":"invited","storeIds":["00000000-0000-4000-8000-00000000a001"],"storeNames":["TENPO ONE 新宿店"],"hasPin":false,"canEdit":true},
          {"membershipId":"m4","profileId":"u4","displayName":"高橋 美咲","displayNameKana":"たかはし みさき","role":"staff","roleLabel":"スタッフ","status":"suspended","storeIds":["00000000-0000-4000-8000-00000000a002"],"storeNames":["TENPO ONE 渋谷店"],"hasPin":false,"canEdit":true}]}
        """) {
            m.payload = p
            m.loaded(p)
        }
        return m
    }

    @MainActor static func kitchen() -> NativeKitchenModel {
        let m = NativeKitchenModel()
        let nowMs = Date().timeIntervalSince1970 * 1000
        m.payload = decode(NKPayload.self, """
        {"ok":true,"now":\(nowMs),"unservedCount":7,"avgElapsedMinutes":9,
         "kdsSettings":{"warn1":5,"warn2":10,"warn3":15,"aggregate":false,"sound":false},
         "stations":{"kitchen":"キッチン","drink":"ドリンク"},"canManageSettings":true,
         "groups":[
          {"orderId":"o1","orderNo":101,"tableName":"T3","orderSource":"pos","orderTime":"\(iso(minutesAgo: 16))","items":[
            {"id":"i1","name":"鶏の唐揚げ","quantity":2,"memo":"レモン別","modifiers":[{"name":"大盛り","price":200}],"station":"kitchen","kitchenStatus":"preparing","createdAt":"\(iso(minutesAgo: 16))"},
            {"id":"i2","name":"だし巻き玉子","quantity":1,"memo":null,"modifiers":[],"station":"kitchen","kitchenStatus":"pending","createdAt":"\(iso(minutesAgo: 16))"}]},
          {"orderId":"o2","orderNo":102,"tableName":"カウンター2","orderSource":"qr","orderTime":"\(iso(minutesAgo: 7))","items":[
            {"id":"i3","name":"生ビール（中）","quantity":3,"memo":null,"modifiers":[],"station":"drink","kitchenStatus":"ready","createdAt":"\(iso(minutesAgo: 7))"},
            {"id":"i4","name":"レモンサワー","quantity":1,"memo":null,"modifiers":[],"station":"drink","kitchenStatus":"pending","createdAt":"\(iso(minutesAgo: 7))"}]},
          {"orderId":"o3","orderNo":103,"tableName":null,"orderSource":"online","orderTime":"\(iso(minutesAgo: 2))","items":[
            {"id":"i5","name":"季節の天ぷら盛り合わせ","quantity":1,"memo":"えび抜き","modifiers":[],"station":"kitchen","kitchenStatus":"pending","createdAt":"\(iso(minutesAgo: 2))"}]}]}
        """)
        m.now = Date()
        return m
    }

    @MainActor static func storeDay() -> NOMStoreDayModel {
        let m = NOMStoreDayModel()
        let today = NOS.str(Date())
        m.payload = decode(NOMCashDay.self, """
        {"store":\(store),"businessDate":"\(today)","period":"day","date":"\(today)",
         "openingItems":[
          {"key":"registers-open","label":"レジ開局状態","valueLabel":"1/1台 開局中","status":"ok","href":null},
          {"key":"reservations","label":"本日の予約組数","valueLabel":"12組","status":"info","href":"/app/reservations"},
          {"key":"inventory","label":"発注点割れの重要在庫","valueLabel":"2品","status":"warn","href":"/app/inventory?sort=warning"}],
         "preCloseItems":[
          {"key":"unpaid-orders","label":"未会計伝票（当営業日）","valueLabel":"0件","status":"ok","href":"/app/orders?status=open"},
          {"key":"unserved-kds","label":"未提供KDS","valueLabel":"1件","status":"warn","href":"/app/kitchen"},
          {"key":"open-registers","label":"未締めレジ","valueLabel":"0台","status":"ok","href":null},
          {"key":"closed-registers","label":"本日締めたレジ","valueLabel":"1台","status":"ok","href":null}],
         "alreadyClosed":false,"canClose":true,"closing":null,
         "breakdown":{
          "bySource":[{"label":"ウォークイン","orders":18,"guests":41,"sales":186400},{"label":"食べログ","orders":6,"guests":19,"sales":98200}],
          "byClerk":[{"label":"佐藤 花子","orders":14,"guests":33,"sales":151000,"items":96},{"label":"鈴木 一郎","orders":10,"guests":27,"sales":133600,"items":71}],
          "courses":[{"name":"宴会コース 2時間飲み放題付","quantity":12,"sales":66000}],
          "foods":[{"name":"鶏の唐揚げ","quantity":24,"sales":16320},{"name":"だし巻き玉子","quantity":15,"sales":8700}],
          "drinks":[{"name":"生ビール（中）","quantity":58,"sales":37700}],
          "nomihoudai":{"planCount":12,"plans":[{"name":"宴会コース 2時間飲み放題付","quantity":12,"sales":66000}],"glasses":46,"drinks":[{"name":"ハイボール","quantity":20,"sales":0}],"orders":2},
          "totals":{"orders":24,"guests":60,"sales":284600},
          "tax":{"byRate":[{"rate":10,"taxable":284600,"tax":25872}],"orderTax":25860}}}
        """)
        m.period = "day"
        m.date = today
        return m
    }

    @MainActor static func refund() -> NPORefundModel {
        let m = NPORefundModel(orderId: "00000000-0000-4000-8000-0000000000c1")
        m.detail = decode(NSDetail.self, """
        {"id":"00000000-0000-4000-8000-0000000000c1","orderNo":1042,"place":"T3","status":"paid","guestCount":3,"subtotal":5200,"taxTotal":472,"serviceCharge":0,
         "discountTotal":0,"discountReason":null,"total":5200,"openedAt":"\(iso(minutesAgo: 120))","closedAt":"\(iso(minutesAgo: 20))","customerName":null,
         "items":[{"id":"oi1","name":"鶏の唐揚げ","unitPrice":680,"quantity":2,"lineTotal":1360,"status":"active","cancelReason":null},
                  {"id":"oi2","name":"生ビール（中）","unitPrice":650,"quantity":4,"lineTotal":2600,"status":"active","cancelReason":null},
                  {"id":"oi3","name":"季節の天ぷら盛り合わせ","unitPrice":1240,"quantity":1,"lineTotal":1240,"status":"active","cancelReason":null}],
         "payments":[{"id":"p1","method":"credit","label":"クレジット（VISA）","amount":5200,"tendered":null,"change":null,"paidAt":"\(iso(minutesAgo: 20))","status":"completed"}],
         "refunds":[],"totalPaid":5200,"totalRefunded":0,"refundable":5200,
         "refundableItems":[{"orderItemId":"oi1","name":"鶏の唐揚げ","remainingQty":2,"remainingAmount":1360},
                            {"orderItemId":"oi2","name":"生ビール（中）","remainingQty":4,"remainingAmount":2600},
                            {"orderItemId":"oi3","name":"季節の天ぷら盛り合わせ","remainingQty":1,"remainingAmount":1240}],
         "paymentBreakdown":[{"method":"credit","label":"クレジット","paid":5200,"refunded":0}],
         "hasVoid":false,"canRefund":true,"canReopen":true,"fullyRefunded":false,"openDerived":null,"ryoshushoIssued":false}
        """)
        return m
    }
}
