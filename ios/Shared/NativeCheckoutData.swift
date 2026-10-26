import Foundation
import SwiftUI

/// 来店経路（Web の lib/handy-visit.ts の VISIT_SOURCES と同じ並び・同じ id）。
/// 2026-10-13 Ronnie「会計の画面にも booking source を全部」
struct NPVisitSource: Identifiable, Codable, Hashable {
    let id: String
    let label: String

    /// iPad は英語で出す（2026-10-13 Ronnie「iPad は全部英語」）。知らない経路は登録の名前のまま
    var english: String { Self.englishLabels[id] ?? label }
    private static let englishLabels: [String: String] = [
        "free": "Walk in", "phone": "Phone (same day)", "tabelog": "Tabelog", "hotpepper": "Hot Pepper",
        "gurunavi": "Gurunavi", "retty": "Retty", "google": "Google", "website": "Website", "sns": "SNS",
        "line": "LINE", "catch": "CATCH", "other": "Other", "ikyu": "Ikyu", "ozmall": "OZmall", "epark": "EPARK",
        "hitosara": "Hitosara", "tablecheck": "TableCheck", "toreta": "Toreta", "ebica": "ebica",
        "instagram": "Instagram", "repeat": "Repeat guest",
    ]

    /// 経路ごとの色（各社のブランドの色に寄せる。2026-10-24 Ronnie「ホットペッパーは赤、食べログは黄色のように、それぞれの色で」）
    var color: Color { Self.colors[id] ?? Color(hex: 0x766B62) }
    /// 黄色など明るい色は文字を黒に
    var darkText: Bool { ["tabelog", "hitosara"].contains(id) }
    private static let colors: [String: Color] = [
        "free": Color(hex: 0x45403B),        // Walk in：チャコール
        "phone": Color(hex: 0x0F8A8A),       // 当日電話：ティール
        "tabelog": Color(hex: 0xFFC400),     // 食べログ：黄
        "hotpepper": Color(hex: 0xE8362D),   // ホットペッパー：赤
        "gurunavi": Color(hex: 0xD7000F),    // ぐるなび：赤
        "retty": Color(hex: 0xF0523F),       // Retty：朱
        "google": Color(hex: 0x4285F4),      // Google：青
        "website": Color(hex: 0x3B5BDB),     // ホームページ：藍
        "sns": Color(hex: 0x8E44AD),         // SNS：紫
        "line": Color(hex: 0x06C755),        // LINE：緑
        "catch": Color(hex: 0xF28C28),       // CATCH：橙
        "other": Color(hex: 0x766B62),       // その他：灰
        "ikyu": Color(hex: 0x1D3C78),        // 一休：紺
        "ozmall": Color(hex: 0xE6007E),      // OZmall：ピンク
        "epark": Color(hex: 0x0099D9),       // EPARK：水色
        "hitosara": Color(hex: 0xF5B700),    // ヒトサラ：黄
        "tablecheck": Color(hex: 0x0B2545),  // TableCheck：濃紺
        "toreta": Color(hex: 0x2DB34A),      // トレタ：緑
        "ebica": Color(hex: 0x2C7BE5),       // ebica：青
        "instagram": Color(hex: 0xD62976),   // Instagram：マゼンタ
        "repeat": Color(hex: 0x1A5AD6),      // リピート：青
    ]

    /// 既定で出す12個（設定 > レジ > 来店経路 で変えられる）
    static let defaults: [NPVisitSource] = [
        .init(id: "free", label: "Walk in"),
        .init(id: "phone", label: "当日電話"),
        .init(id: "tabelog", label: "食べログ"),
        .init(id: "hotpepper", label: "ホットペッパー"),
        .init(id: "gurunavi", label: "ぐるなび"),
        .init(id: "retty", label: "Retty"),
        .init(id: "google", label: "Google"),
        .init(id: "website", label: "ホームページ"),
        .init(id: "sns", label: "SNS"),
        .init(id: "line", label: "LINE"),
        .init(id: "catch", label: "CATCH"),
        .init(id: "other", label: "その他"),
    ]

    /// 設定で足せるもの
    static let extras: [NPVisitSource] = [
        .init(id: "ikyu", label: "一休"),
        .init(id: "ozmall", label: "OZmall"),
        .init(id: "epark", label: "EPARK"),
        .init(id: "hitosara", label: "ヒトサラ"),
        .init(id: "tablecheck", label: "TableCheck"),
        .init(id: "toreta", label: "トレタ"),
        .init(id: "ebica", label: "ebica"),
        .init(id: "instagram", label: "Instagram"),
        .init(id: "repeat", label: "リピート"),
    ]
}

/// 支払方法（Web の会計画面と同じ。2026-09-24 要望で 商品券・掛売 は出さない）
enum NPPayMethod: String, CaseIterable, Identifiable, Codable {
    case cash, credit, qr, emoney, external, other, points, sitePoints = "site_points"
    var id: String { rawValue }

    var label: String {
        switch self {
        case .cash: return "現金"
        case .credit: return "クレジット"
        case .qr: return "QRコード"
        case .emoney: return "電子マネー"
        case .external: return "外部端末"
        case .other: return "その他"
        case .points: return "自社ポイント"
        case .sitePoints: return "サイトのポイント"
        }
    }

    /// iPad の画面は英語を主に出す（日本語は下に小さく）
    var english: String {
        switch self {
        case .cash: return "Cash"
        case .credit: return "Credit card"
        case .qr: return "QR code"
        case .emoney: return "E-money / IC"
        case .external: return "Other terminal"
        case .other: return "Other"
        case .points: return "Store points"
        case .sitePoints: return "Site points"
        }
    }

    /// 支払方法ごとの色（2026-10-24 Ronnie「ボタンの色はそれぞれの色で」）
    var color: Color {
        switch self {
        case .cash: return Color(hex: 0x1E8F62)        // 現金：緑
        case .credit: return Color(hex: 0x1A5AD6)      // クレジット：青
        case .qr: return Color(hex: 0xE4002B)          // QR：赤（PayPay 等）
        case .emoney: return Color(hex: 0xF28C28)      // 電子マネー：橙
        case .external: return Color(hex: 0x6E63B8)    // 外部端末：紫
        case .other: return Color(hex: 0x766B62)       // その他：灰
        case .points: return Color(hex: 0xB7791F)      // 自社ポイント：琥珀
        case .sitePoints: return Color(hex: 0xD98A00)  // サイトのポイント：橙金
        }
    }

    var icon: String {
        switch self {
        case .cash: return "yensign.circle"
        case .credit: return "creditcard"
        case .qr: return "qrcode"
        case .emoney: return "wave.3.right.circle"
        case .external: return "rectangle.portrait.and.arrow.right"
        case .other: return "ellipsis.circle"
        case .points, .sitePoints: return "star.circle"
        }
    }
}

struct NPBrand: Identifiable, Hashable, Codable {
    let id: String
    let name: String

    /// 各社のブランドの色（分からないものは nil ＝ 支払方法の色）
    var color: Color? { Self.colors[id] }
    private static let colors: [String: Color] = [
        "visa": Color(hex: 0x1A1F71), "master": Color(hex: 0xEB001B), "jcb": Color(hex: 0x0E4C96), "amex": Color(hex: 0x2E77BC),
        "diners": Color(hex: 0x0079BE), "unionpay": Color(hex: 0xE21836),
        "paypay": Color(hex: 0xFF0033), "rakutenpay": Color(hex: 0xBF0000), "dbarai": Color(hex: 0xCC0033), "aupay": Color(hex: 0xEB5505),
        "alipay": Color(hex: 0x1677FF), "wechatpay": Color(hex: 0x07C160), "merpay": Color(hex: 0x4DC9F6), "linepay": Color(hex: 0x06C755),
        "transit": Color(hex: 0x1A9A55), "id": Color(hex: 0xE60012), "quicpay": Color(hex: 0x0068B7), "edy": Color(hex: 0xBF0000),
        "nanaco": Color(hex: 0xF39800), "waon": Color(hex: 0x7F3F98),
        "hotpepper": Color(hex: 0xE8362D), "gurunavi": Color(hex: 0xD7000F), "tabelog": Color(hex: 0xFFC400),
        "discover": Color(hex: 0xE86A10), "aeonpay": Color(hex: 0xB6007A), "famipay": Color(hex: 0x0A7CC4), "jcoinpay": Color(hex: 0x1D3C8F),
        "bankpay": Color(hex: 0x0098D8), "yuchopay": Color(hex: 0x00843D), "alipayplus": Color(hex: 0x1677FF),
        "square": Color(hex: 0x1A1A1A), "airpay": Color(hex: 0x1AA1DC), "usenpay": Color(hex: 0xD6001C), "paygate": Color(hex: 0x1E3A8A),
        "stera-manual": Color(hex: 0x0B6E6E),
    ]

    /// 白い地に置くと字が読みにくい明るい色（字は濃い色にして、下の線だけ色を付ける）
    var isBright: Bool { Self.bright.contains(id) }
    private static let bright: Set<String> = ["tabelog", "merpay", "nanaco"]

    /// iPad は英語で出す。知らないもの（店で足した名前）はそのまま
    var english: String { Self.englishNames[id] ?? name }
    private static let englishNames: [String: String] = [
        "unionpay": "UnionPay", "rakutenpay": "Rakuten Pay", "dbarai": "d Barai", "merpay": "Merpay",
        "transit": "Transit IC", "edy": "Rakuten Edy", "hotpepper": "Hot Pepper", "gurunavi": "Gurunavi", "tabelog": "Tabelog",
        "airpay": "AirPAY", "stera-manual": "stera (manual)",
    ]
}

/// 支払方法の内訳（設定していない店舗の既定。Web の DEFAULT_METHOD_BRANDS と同じ）
enum NPBrands {
    static let credit: [NPBrand] = [
        .init(id: "visa", name: "VISA"), .init(id: "master", name: "Mastercard"), .init(id: "jcb", name: "JCB"),
        .init(id: "amex", name: "AMEX"), .init(id: "diners", name: "Diners"), .init(id: "unionpay", name: "銀聯"),
    ]
    static let qr: [NPBrand] = [
        .init(id: "paypay", name: "PayPay"), .init(id: "rakutenpay", name: "楽天ペイ"), .init(id: "dbarai", name: "d払い"),
        .init(id: "aupay", name: "au PAY"), .init(id: "alipay", name: "Alipay"), .init(id: "wechatpay", name: "WeChat Pay"),
        .init(id: "merpay", name: "メルペイ"), .init(id: "linepay", name: "LINE Pay"),
    ]
    static let emoney: [NPBrand] = [
        .init(id: "transit", name: "交通系IC"), .init(id: "id", name: "iD"), .init(id: "quicpay", name: "QUICPay"),
        .init(id: "edy", name: "楽天Edy"), .init(id: "nanaco", name: "nanaco"), .init(id: "waon", name: "WAON"),
    ]
    /// サイトのポイント（ホットペッパー・ぐるなび・食べログ）
    static let sitePoints: [NPBrand] = [
        .init(id: "hotpepper", name: "ホットペッパー"), .init(id: "gurunavi", name: "ぐるなび"), .init(id: "tabelog", name: "食べログ"),
    ]

    static func of(_ m: NPPayMethod) -> [NPBrand] {
        switch m {
        case .credit: return credit
        case .qr: return qr
        case .emoney: return emoney
        case .sitePoints: return sitePoints
        default: return []
        }
    }

    /// 設定で「使うもの」を選ぶための一覧（店はここから選ぶ。無いものは自分で足す）
    /// 2026-10-24 22:35 Ronnie「店が使うものを選んで、会計画面に出す」
    static func catalog(_ methodId: String) -> [NPBrand] {
        switch methodId {
        case "credit": return credit + [.init(id: "discover", name: "Discover")]
        case "qr":
            return [
                .init(id: "paypay", name: "PayPay"), .init(id: "rakutenpay", name: "楽天ペイ"), .init(id: "dbarai", name: "d払い"),
                .init(id: "aupay", name: "au PAY"), .init(id: "merpay", name: "メルペイ"), .init(id: "aeonpay", name: "AEON Pay"),
                .init(id: "famipay", name: "FamiPay"), .init(id: "jcoinpay", name: "J-Coin Pay"), .init(id: "bankpay", name: "Bank Pay"),
                .init(id: "yuchopay", name: "ゆうちょPay"), .init(id: "alipay", name: "Alipay"), .init(id: "alipayplus", name: "Alipay+"),
                .init(id: "wechatpay", name: "WeChat Pay"), .init(id: "linepay", name: "LINE Pay"),
            ]
        case "emoney": return emoney
        // 外部端末：店にある決済端末（stera はつなぐと自動で出る。つないでいない端末はここで名前を選ぶ）
        case "external":
            return [
                .init(id: "square", name: "Square"), .init(id: "airpay", name: "Airペイ"), .init(id: "usenpay", name: "USEN PAY"),
                .init(id: "paygate", name: "PAYGATE"), .init(id: "stera-manual", name: "stera（手動）"),
            ]
        default: return []
        }
    }
}

/// 支払の種類のタイル（会計画面・設定で同じ形）。白いカードに各社の色の名前と下の線（ロゴの絵は使わない）
/// 2026-10-24 22:35 Ronnie「会計の支払いにロゴのように並べて」
struct NPBrandTile: View {
    let brand: NPBrand
    let fallback: Color
    let on: Bool
    var height: CGFloat = 62

    var body: some View {
        // 色を付けない（白い地に濃い字・選ぶと紫紺。2026-10-27 03:21 Ronnie「sabai ko color milau colorfull pardaina」）
        let plain = true
        let c = plain ? OV.primary : (brand.color ?? fallback)
        let bright = plain ? false : brand.isBright
        let ink: Color = on ? (bright ? Color(hex: 0x292725) : .white) : (plain ? OV.ink : (bright ? Color(hex: 0x292725) : c))
        VStack(spacing: 1) {
            Text(brand.name).font(.system(size: 17, weight: NT.strong)).foregroundColor(ink)
            if brand.english != brand.name {
                Text(brand.english).font(.system(size: 10, weight: .semibold)).foregroundColor(ink.opacity(on ? 0.85 : 0.6))
            }
        }
        .lineLimit(1).minimumScaleFactor(0.55)
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, minHeight: height)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? c : Color.white))
        .overlay(alignment: .bottom) {
            if !on && !plain { Rectangle().fill(c).frame(height: 4).padding(.horizontal, 14).clipShape(Capsule()).padding(.bottom, 5) }
        }
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? c : (plain ? OV.line : Color(hex: 0xDCE3EF)), lineWidth: on ? 2 : 1))
        .overlay(alignment: .topTrailing) {
            if on {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 15, weight: .bold))
                    .foregroundColor(bright ? Color(hex: 0x292725) : .white).padding(5)
            }
        }
        .shadow(color: Color.black.opacity(on ? 0.12 : 0.05), radius: on ? 5 : 3, y: on ? 2 : 1)
    }
}

/// 決めておいた値引き（グルメサイトのクーポンなど。Web の DEFAULT_DISCOUNT_PRESETS）
struct NPDiscountPreset: Identifiable, Hashable {
    enum Kind { case percent, amount, manual }
    let id: String
    let name: String
    let kind: Kind
    let value: Int

    /// iPad は英語で出す（店で付けた名前はそのまま）
    var english: String { id == "kanji-free" || name == "幹事様無料" ? "Organizer free" : name }

    static let defaults: [NPDiscountPreset] = [
        .init(id: "kanji-free", name: "幹事様無料", kind: .manual, value: 0),
    ]
}

/// 会計の支払い1行（現金＋カードのように分けて払える）
struct NPPaymentRow: Identifiable, Hashable {
    let id = UUID()
    let method: NPPayMethod
    let brand: NPBrand?
    var amount: Int
    /// 現金の預り金
    var tendered: Int = 0

    var title: String { brand.map { "\(method.english) · \($0.english)" } ?? method.english }
}
