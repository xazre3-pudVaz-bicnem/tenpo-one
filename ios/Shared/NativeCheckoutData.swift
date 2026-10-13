import Foundation

/// 来店経路（Web の lib/handy-visit.ts の VISIT_SOURCES と同じ並び・同じ id）。
/// 2026-10-13 Ronnie「会計の画面にも booking source を全部」
struct NPVisitSource: Identifiable, Codable, Hashable {
    let id: String
    let label: String

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

    var english: String {
        switch self {
        case .cash: return "Cash"
        case .credit: return "Card"
        case .qr: return "QR"
        case .emoney: return "IC / e-money"
        case .external: return "Terminal"
        case .other: return "Other"
        case .points, .sitePoints: return "Points"
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
}

/// 決めておいた値引き（グルメサイトのクーポンなど。Web の DEFAULT_DISCOUNT_PRESETS）
struct NPDiscountPreset: Identifiable, Hashable {
    enum Kind { case percent, amount, manual }
    let id: String
    let name: String
    let kind: Kind
    let value: Int

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

    var title: String { brand.map { "\(method.label)・\($0.name)" } ?? method.label }
}
