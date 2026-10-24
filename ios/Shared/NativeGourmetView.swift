import SwiftUI
import UIKit

// グルメ連携（ネイティブ）。店舗台帳 › 📅 › グルメ連携。Web の 予約台帳設定 › グルメ連携 と同じ働き
// （2026-10-24 Ronnie「iOS でもグルメ連携を台帳に。管理画面からも」）:
//   取り込み専用アドレス（コピー）／オン・オフ／サイトごとの「登録した」印と状態／取り込み履歴（要確認 → 対応済み）
// サーバー: GET /api/app/v1/pos?part=gourmet、POST { type: 'gourmet…' }（lib/native-gourmet.ts）。中身は Web と同じ Server Action。

struct NGSite: Codable, Identifiable, Hashable {
    var id: String { key }
    let key: String
    let name: String
    let en: String
    let adminUrl: String?
    let howTo: String
    /// off / registered / verified
    let status: String
    let enabledAt: String?
    let verifiedAt: String?
    let lastImportAt: String?
    let lastKind: String?
}

struct NGParsed: Codable, Hashable {
    let date: String?
    let time: String?
    let partySize: Double?
    let guestName: String?
    let phone: String?
    let links: [String]?
}

struct NGImport: Codable, Identifiable, Hashable {
    let id: String
    let site: String
    let siteName: String
    let kind: String
    let kindLabel: String
    let status: String
    let statusLabel: String
    let subject: String?
    let fromAddress: String?
    let externalId: String?
    let receivedAt: String
    let reservationId: String?
    let reservedDate: String?
    let error: String?
    let resolvedAt: String?
    let parsed: NGParsed?
    let bodyText: String?

    var needsReview: Bool { status == "needs_review" && resolvedAt == nil }
}

struct NGPayload: Codable {
    let store: NFNamed
    let enabled: Bool
    let address: String?
    let domain: String
    let inboundReady: Bool
    let canRegenerate: Bool
    let canWrite: Bool
    let verifiedCount: Int
    let sites: [NGSite]
    let imports: [NGImport]
    let pendingReview: Int
}

// MARK: - 予約の入り口（グルメサイト）の色と短い名前。台帳の箱・一覧・詳細で同じものを使う

enum NLSource {
    struct Style: Hashable {
        let label: String
        let color: Color
    }

    /// reservation_sources.code → 色と短い名前（サイトの色に寄せる。無いものは紫）
    static func style(code: String?, createdVia: String, name: String?) -> Style? {
        switch code {
        case "tabelog": return Style(label: "食べログ", color: Color(hex: 0xEF7A1A))
        case "hotpepper": return Style(label: "HotPepper", color: Color(hex: 0xE5002D))
        case "gurunavi": return Style(label: "ぐるなび", color: Color(hex: 0xB7152B))
        case "ikyu": return Style(label: "一休", color: Color(hex: 0x1B2A6B))
        case "retty": return Style(label: "Retty", color: Color(hex: 0xF15A24))
        case "ozmall": return Style(label: "OZmall", color: Color(hex: 0xE4007F))
        case "hitosara": return Style(label: "ヒトサラ", color: Color(hex: 0x009944))
        case "yahoo_line": return Style(label: "LINE/Yahoo!", color: Color(hex: 0x06C755))
        case "google": return Style(label: "Google", color: Color(hex: 0x4285F4))
        case "tablecheck": return Style(label: "TableCheck", color: Color(hex: 0x00A3A1))
        case "omakase": return Style(label: "OMAKASE", color: Color(hex: 0x333333))
        case "gourmet_site": return Style(label: "グルメ", color: Color(hex: 0x8E44AD))
        case "web": return Style(label: "WEB", color: Color(hex: 0x6D4ACF))
        case "phone": return Style(label: "TEL", color: Color(hex: 0x3C7A89))
        case "manual": return Style(label: "手動", color: Color(hex: 0x6B7280))
        case "walk_in": return nil
        default: break
        }
        // code が無いとき（古い経路・会社ごとの経路）は入り口の名前か登録のしかた
        if createdVia == "walk_in" { return nil }
        if let n = name?.trimmingCharacters(in: .whitespaces), !n.isEmpty {
            return Style(label: n.count <= 6 ? n : String(n.prefix(5)), color: createdVia == "gourmet_mail" ? Color(hex: 0x8E44AD) : Color(hex: 0x6B7280))
        }
        switch createdVia {
        case "web": return Style(label: "WEB", color: Color(hex: 0x6D4ACF))
        case "phone": return Style(label: "TEL", color: Color(hex: 0x3C7A89))
        case "manual": return Style(label: "手動", color: Color(hex: 0x6B7280))
        case "gourmet_mail": return Style(label: "グルメ", color: Color(hex: 0x8E44AD))
        default: return nil
        }
    }

    /// 台帳の 1 件の予約の入り口（sourceId → sources の code。無ければ名前で探す）
    static func style(for r: NLReservation, in p: NLPayload) -> Style? {
        var code: String? = nil
        if let id = r.sourceId { code = p.sourceRows.first { $0.id == id }?.code }
        if code == nil, let n = r.sourceName { code = p.sourceRows.first { $0.name == n }?.code ?? p.sources.first { $0.name == n }?.code }
        return style(code: code, createdVia: r.createdVia, name: r.sourceName)
    }
}

/// 入り口の小さな印（色つき）。メール取り込み（自動）は封筒のマーク
struct NLSourceChip: View {
    let style: NLSource.Style
    var auto: Bool = false
    var size: CGFloat = 10

    var body: some View {
        HStack(spacing: 2) {
            if auto { Image(systemName: "envelope.fill").font(.system(size: size - 1, weight: .bold)) }
            Text(style.label).font(.system(size: size, weight: .heavy)).lineLimit(1)
        }
        .foregroundColor(.white)
        .padding(.horizontal, size * 0.55).padding(.vertical, size * 0.2)
        .background(Capsule().fill(style.color))
    }
}

// MARK: - 画面

@MainActor
final class NativeGourmetModel: ObservableObject {
    @Published var payload: NGPayload?
    @Published var loading = false
    @Published var busy = false
    @Published var error: String?
    @Published var toast: String?

    func load(silent: Bool = false) async {
        if !silent { loading = true }
        do {
            var comps = URLComponents(url: AppConfig.url("/api/app/v1/pos"), resolvingAgainstBaseURL: false)!
            comps.queryItems = [URLQueryItem(name: "part", value: "gourmet")]
            let data = try await NativeAPI.shared.send(URLRequest(url: comps.url!))
            payload = try JSONDecoder().decode(NGPayload.self, from: data)
            error = nil
        } catch {
            if !silent || payload == nil { self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした" }
        }
        loading = false
    }

    /// 操作（オン・オフ／登録印／対応済み／作り直し）。終わったら読み直す
    @discardableResult
    func act(_ body: [String: Any], done: String? = nil) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            let r = try await NativeAPI.shared.act(body, throwOnFail: false)
            if !r.ok { error = r.error ?? "うまくいきませんでした"; return false }
            await load(silent: true)
            if let done { toast = done }
            return true
        } catch {
            self.error = (error as? NativeAPIError)?.message ?? "通信できませんでした"
            return false
        }
    }

    func copyAddress() {
        guard let a = payload?.address else { return }
        UIPasteboard.general.string = a
        toast = "取り込み専用アドレスをコピーしました"
    }
}

/// 時刻（JST）。無ければ ----
func ngJst(_ iso: String?, withYear: Bool = true) -> String {
    guard let iso, !iso.isEmpty else { return "----/--/-- --:--" }
    let p = ISO8601DateFormatter()
    p.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var d = p.date(from: iso)
    if d == nil { p.formatOptions = [.withInternetDateTime]; d = p.date(from: iso) }
    guard let date = d else { return iso }
    let f = DateFormatter()
    f.locale = Locale(identifier: "ja_JP")
    f.timeZone = TimeZone(identifier: "Asia/Tokyo")
    f.dateFormat = withYear ? "yyyy/MM/dd HH:mm" : "MM/dd HH:mm"
    return f.string(from: date)
}

struct NativeGourmetSheet: View {
    let onClose: () -> Void
    /// 「台帳で見る」（予約 ID とその来店日）
    let onOpenReservation: (String, String?) -> Void

    @StateObject private var model = NativeGourmetModel()
    @State private var openSite: NGSite?
    @State private var openImport: String?
    @State private var regenerateOpen = false

    var body: some View {
        NavigationStack {
            ZStack {
                NLColor.page.ignoresSafeArea()
                if let p = model.payload {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            intro(p)
                            toggleCard(p)
                            if p.enabled, let address = p.address {
                                addressCard(p, address: address)
                                sitesCard(p)
                            }
                            importsCard(p)
                        }
                        .padding(20)
                        .frame(maxWidth: 900)
                        .frame(maxWidth: .infinity)
                    }
                } else if let e = model.error {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.red)
                        Button("もう一度") { Task { await model.load() } }
                    }
                } else {
                    ProgressView("読み込み中…").tint(NLColor.blue)
                }
            }
            .navigationTitle("グルメ連携 / Gourmet sites")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("閉じる", action: onClose) }
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.load(silent: true) } } label: { Image(systemName: "arrow.clockwise") }.disabled(model.busy)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let t = model.toast {
                Text(t).font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).padding(.vertical, 12)
                    .background(Capsule().fill(NLColor.navy.opacity(0.95)))
                    .padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); if model.toast == t { model.toast = nil } }
            }
        }
        .overlay(alignment: .top) {
            if let e = model.error, model.payload != nil {
                Button { model.error = nil } label: {
                    HStack { Image(systemName: "exclamationmark.triangle.fill"); Text(e); Spacer(); Image(systemName: "xmark") }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(Color(hex: 0xB42318))
                        .padding(12).background(RoundedRectangle(cornerRadius: 12).fill(NLColor.redSoft))
                        .frame(maxWidth: 720)
                }
                .buttonStyle(.plain)
                .padding(.top, 60)
            }
        }
        .sheet(item: $openSite) { s in siteSheet(s) }
        .alert("取り込み専用アドレスを作り直しますか", isPresented: $regenerateOpen) {
            Button("作り直す", role: .destructive) {
                Task { await model.act(["type": "gourmetRegenerate"], done: "新しいアドレスを作りました") }
            }
            Button("戻る", role: .cancel) {}
        } message: {
            Text("各サイトに登録した古いアドレスには届かなくなるので、登録し直しが必要です。")
        }
        .task { await model.load() }
    }

    // MARK: 説明・オン・オフ

    private func intro(_ p: NGPayload) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("食べログ・ホットペッパー・ぐるなび・一休・Retty・OZmall・ヒトサラ・LINEで予約・Google など、日本のグルメサイトの新規予約・変更・キャンセルのメールを自動で読んで、\(p.store.name) のご予約台帳に入れます。各サイトの店舗管理画面で、予約通知メールの送り先に下のアドレスを登録するだけです。")
                .font(.system(size: 14)).foregroundColor(NLColor.muted).fixedSize(horizontal: false, vertical: true)
            if !p.inboundReady {
                Text("メールの受け口（\(p.domain) の MX と INBOUND_MAIL_SECRET）はまだ運営側で設定中です。設定が終わるまでは、アドレスを登録してもメールは取り込まれません。")
                    .font(.system(size: 12)).foregroundColor(Color(hex: 0x8A6100))
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.yellowSoft))
            }
        }
    }

    private func toggleCard(_ p: NGPayload) -> some View {
        card {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("グルメサイトメール取り込み").font(.system(size: 17, weight: .heavy)).foregroundColor(NLColor.ink)
                    Text(p.enabled ? "利用中（\(p.verifiedCount) サイト設定済）" : "停止中").font(.system(size: 13)).foregroundColor(NLColor.muted)
                }
                Spacer()
                Toggle("", isOn: Binding(get: { p.enabled }, set: { on in
                    Task { await model.act(["type": "gourmetEnable", "enabled": on], done: on ? "メール取り込みをオンにしました" : "メール取り込みをオフにしました") }
                }))
                .labelsHidden()
                .tint(NLColor.blue)
                .disabled(model.busy || !p.canWrite)
            }
            .padding(16)
        }
    }

    // MARK: 取り込み専用アドレス

    private func addressCard(_ p: NGPayload, address: String) -> some View {
        card {
            VStack(alignment: .leading, spacing: 10) {
                Text("取り込み専用メールアドレス / Import address").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted)
                HStack(spacing: 10) {
                    Text(address).font(.system(size: 16, weight: .semibold, design: .monospaced)).foregroundColor(NLColor.ink)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 10).fill(NLColor.graySoft))
                    Button { model.copyAddress() } label: {
                        Label("コピー", systemImage: "doc.on.doc").font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 16).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.navy))
                    }
                    .buttonStyle(PressableStyle())
                    if p.canRegenerate {
                        Button { regenerateOpen = true } label: {
                            Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.navy)
                                .frame(width: 44, height: 44)
                                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1))
                        }
                        .buttonStyle(PressableStyle())
                        .disabled(model.busy)
                        .accessibilityLabel("アドレスを作り直す（運営のみ）")
                    }
                }
                Text("※ 各サイトの店舗管理画面（ID／パスワード）が必要です。登録すると、サイトから確認メールや予約メールが届いた時点で「設定済」になります。このアドレスは固定です（変更は運営 CYPRESS のみ）。")
                    .font(.system(size: 11)).foregroundColor(NLColor.muted).fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
        }
    }

    // MARK: サイト一覧

    private func statusBadge(_ status: String) -> some View {
        let (label, fg, bg, icon): (String, Color, Color, String?) = { () -> (String, Color, Color, String?) in
            switch status {
            case "verified": return ("設定済", Color(hex: 0x036B4A), NLColor.greenSoft, "checkmark.circle.fill")
            case "registered": return ("メール待ち", Color(hex: 0x8A6100), NLColor.yellowSoft, "exclamationmark.circle.fill")
            default: return ("未設定", NLColor.muted, NLColor.graySoft, nil)
            }
        }()
        return HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 11, weight: .bold)) }
            Text(label).font(.system(size: 12, weight: .bold))
        }
        .foregroundColor(fg)
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(Capsule().fill(bg))
    }

    private func sitesCard(_ p: NGPayload) -> some View {
        card {
            VStack(spacing: 0) {
                ForEach(p.sites) { s in
                    Button { openSite = s } label: {
                        HStack(spacing: 12) {
                            if let st = NLSource.style(code: s.key == "other" ? "gourmet_site" : s.key, createdVia: "gourmet_mail", name: s.name) {
                                Circle().fill(st.color).frame(width: 10, height: 10)
                            }
                            VStack(alignment: .leading, spacing: 1) {
                                Text(s.name).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.ink)
                                Text(s.en).font(.system(size: 11)).foregroundColor(NLColor.muted)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 1) {
                                Text("最新メール取り込み：\(ngJst(s.lastImportAt))").font(.system(size: 11)).monospacedDigit().foregroundColor(NLColor.muted)
                                Text("設定：\(ngJst(s.enabledAt ?? s.verifiedAt))\(s.lastKind.map { "（最後：\(ngKindLabel($0))）" } ?? "")").font(.system(size: 11)).monospacedDigit().foregroundColor(NLColor.muted)
                            }
                            statusBadge(s.status).frame(width: 100, alignment: .trailing)
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.gray)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 12)
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .bottom) { if s.id != p.sites.last?.id { Rectangle().fill(NLColor.line).frame(height: 1) } }
                }
            }
        }
    }

    private func ngKindLabel(_ k: String) -> String {
        ["new": "新規予約", "change": "予約変更", "cancel": "キャンセル", "verify": "メール認証", "unknown": "判別できず"][k] ?? k
    }

    /// サイトごとの設定手順（Web のダイアログと同じ 3 ステップ）
    private func siteSheet(_ s: NGSite) -> some View {
        let site = model.payload?.sites.first { $0.key == s.key } ?? s
        let address = model.payload?.address ?? ""
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 10) {
                        Text(site.name).font(.system(size: 22, weight: .heavy)).foregroundColor(NLColor.ink)
                        statusBadge(site.status)
                    }
                    step("1. 取り込み専用アドレスをコピー") {
                        HStack(spacing: 10) {
                            Text(address).font(.system(size: 14, weight: .semibold, design: .monospaced)).textSelection(.enabled)
                                .padding(.horizontal, 10).padding(.vertical, 8).background(RoundedRectangle(cornerRadius: 8).fill(NLColor.graySoft))
                            Button { model.copyAddress() } label: { Label("コピー", systemImage: "doc.on.doc").font(.system(size: 14, weight: .bold)) }.buttonStyle(.bordered)
                        }
                    }
                    step("2. \(site.name) の店舗管理画面で、予約通知メールの送り先に登録") {
                        Text(site.howTo).font(.system(size: 14)).foregroundColor(NLColor.ink).fixedSize(horizontal: false, vertical: true)
                        if let u = site.adminUrl, let url = URL(string: u) {
                            Button { UIApplication.shared.open(url) } label: {
                                Label("\(site.name) の店舗管理画面を開く", systemImage: "arrow.up.right.square").font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                                    .padding(.horizontal, 14).frame(height: 40)
                                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(NLColor.blue))
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                    step("3. 登録できたら印を付ける") {
                        Text("サイトから最初のメール（確認メールか予約メール）が届いた時点で「設定済」に変わります。届かないときは、登録したアドレスを見直してください。")
                            .font(.system(size: 13)).foregroundColor(NLColor.muted).fixedSize(horizontal: false, vertical: true)
                        if model.payload?.canWrite ?? false {
                            if site.status == "off" {
                                Button {
                                    Task { await model.act(["type": "gourmetMarkSite", "site": site.key, "registered": true], done: "登録した印を付けました。最初のメールが届くと「設定済」になります") }
                                } label: {
                                    Label("登録した", systemImage: "checkmark").font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.navy)
                                        .padding(.horizontal, 16).frame(height: 44)
                                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NLColor.yellow))
                                }
                                .buttonStyle(PressableStyle()).disabled(model.busy)
                            } else {
                                Button {
                                    Task { await model.act(["type": "gourmetMarkSite", "site": site.key, "registered": false], done: "印を外しました") }
                                } label: {
                                    Text("印を外す").font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.navy)
                                        .padding(.horizontal, 16).frame(height: 44)
                                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(NLColor.line, lineWidth: 1))
                                }
                                .buttonStyle(PressableStyle()).disabled(model.busy)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(NLColor.page.ignoresSafeArea())
            .navigationTitle("\(site.name) の設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("閉じる") { openSite = nil } } }
        }
    }

    private func step<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 15, weight: .bold)).foregroundColor(NLColor.navy)
            content()
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(NLColor.card))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NLColor.line, lineWidth: 1))
    }

    // MARK: 取り込み履歴

    private func importStatusTone(_ r: NGImport) -> (Color, Color) {
        if r.needsReview { return (Color(hex: 0xB42318), NLColor.redSoft) }
        if r.resolvedAt != nil { return (NLColor.muted, NLColor.graySoft) }
        switch r.status {
        case "imported", "updated": return (Color(hex: 0x036B4A), NLColor.greenSoft)
        case "cancelled": return (.white, NLColor.navy2)
        case "verified": return (Color(hex: 0x0B3A8C), NLColor.blueSoft)
        default: return (NLColor.muted, NLColor.graySoft)
        }
    }

    private func importsCard(_ p: NGPayload) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "tray.full").foregroundColor(NLColor.blue)
                Text("取り込み履歴").font(.system(size: 17, weight: .heavy)).foregroundColor(NLColor.navy)
                Text("Imports").font(.system(size: 11)).foregroundColor(NLColor.muted)
                if p.pendingReview > 0 {
                    Text("要確認 \(p.pendingReview)").font(.system(size: 12, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NLColor.red))
                }
            }
            card {
                if p.imports.isEmpty {
                    Text("まだ取り込んだメールはありません。").font(.system(size: 14)).foregroundColor(NLColor.muted).padding(16)
                } else {
                    VStack(spacing: 0) {
                        ForEach(p.imports) { r in importRow(r, last: r.id == p.imports.last?.id) }
                    }
                }
            }
        }
    }

    private func importRow(_ r: NGImport, last: Bool) -> some View {
        let open = openImport == r.id
        let tone = importStatusTone(r)
        let pr = r.parsed
        let summary: String = { () -> String in
            if let d = pr?.date, !d.isEmpty {
                let n = pr?.partySize.map { "\(Int($0))" } ?? "?"
                return "\(d) \(pr?.time ?? "") \(n)名 \(pr?.guestName ?? "")"
            }
            return r.subject ?? ""
        }()
        return VStack(spacing: 0) {
            Button { openImport = open ? nil : r.id } label: {
                HStack(spacing: 10) {
                    Text(ngJst(r.receivedAt, withYear: false)).font(.system(size: 12)).monospacedDigit().foregroundColor(NLColor.muted).frame(width: 84, alignment: .leading)
                    HStack(spacing: 6) {
                        if let st = NLSource.style(code: r.site == "other" ? "gourmet_site" : r.site, createdVia: "gourmet_mail", name: r.siteName) {
                            Circle().fill(st.color).frame(width: 8, height: 8)
                        }
                        Text(r.siteName).font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.ink).lineLimit(1)
                    }
                    .frame(width: 150, alignment: .leading)
                    Text(r.kindLabel).font(.system(size: 12)).foregroundColor(NLColor.muted).frame(width: 72, alignment: .leading)
                    Text(summary).font(.system(size: 13)).foregroundColor(NLColor.ink).lineLimit(1)
                    Spacer()
                    if r.kind == "verify", !(pr?.links ?? []).isEmpty, r.resolvedAt == nil {
                        Text("要クリック").font(.system(size: 11, weight: .bold)).foregroundColor(Color(hex: 0x8A6100))
                            .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(NLColor.yellowSoft))
                    }
                    Text(r.resolvedAt != nil ? "対応済み" : r.statusLabel).font(.system(size: 11, weight: .bold)).foregroundColor(tone.0)
                        .padding(.horizontal, 8).padding(.vertical, 3).background(Capsule().fill(tone.1))
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.gray)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
            }
            .buttonStyle(.plain)
            if open {
                VStack(alignment: .leading, spacing: 6) {
                    detail("件名", r.subject ?? "—")
                    detail("差出人", r.fromAddress ?? "—")
                    if let x = r.externalId { detail("予約番号", x) }
                    if let e = r.error { detail("理由", e, color: NLColor.red) }
                    if let body = r.bodyText, !body.isEmpty {
                        ScrollView {
                            Text(body).font(.system(size: 12)).foregroundColor(NLColor.ink).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(10)
                        }
                        .frame(maxHeight: 220)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                    }
                    if r.kind == "verify", let links = pr?.links, !links.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("認証メールのリンク（開くとサイト側の登録が完了します）").font(.system(size: 11, weight: .bold)).foregroundColor(NLColor.muted)
                            HStack(spacing: 8) {
                                ForEach(links, id: \.self) { l in
                                    if let url = URL(string: l) {
                                        Button { UIApplication.shared.open(url) } label: {
                                            Text("認証リンクを開く").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                                                .padding(.horizontal, 12).frame(height: 36)
                                                .background(RoundedRectangle(cornerRadius: 8).fill(NLColor.blue))
                                        }
                                        .buttonStyle(PressableStyle())
                                    }
                                }
                            }
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                    }
                    HStack(spacing: 8) {
                        if let rid = r.reservationId {
                            Button { onOpenReservation(rid, r.reservedDate) } label: {
                                Text("台帳で見る").font(.system(size: 13, weight: .bold)).foregroundColor(NLColor.blue)
                                    .padding(.horizontal, 12).frame(height: 36)
                                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.white))
                                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(NLColor.line, lineWidth: 1))
                            }
                            .buttonStyle(PressableStyle())
                        }
                        if r.needsReview, model.payload?.canWrite ?? false {
                            Button { Task { await model.act(["type": "gourmetResolve", "importId": r.id], done: "対応済みにしました") } } label: {
                                Label("対応済みにする", systemImage: "checkmark").font(.system(size: 13, weight: .bold)).foregroundColor(.white)
                                    .padding(.horizontal, 12).frame(height: 36)
                                    .background(RoundedRectangle(cornerRadius: 8).fill(NLColor.navy))
                            }
                            .buttonStyle(PressableStyle()).disabled(model.busy)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(NLColor.page)
            }
            if !last { Rectangle().fill(NLColor.line).frame(height: 1) }
        }
    }

    private func detail(_ label: String, _ value: String, color: Color = NLColor.ink) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label).font(.system(size: 12, weight: .bold)).foregroundColor(NLColor.muted).frame(width: 56, alignment: .leading)
            Text(value).font(.system(size: 13)).foregroundColor(color).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 部品

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0, content: content)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NLColor.card))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(NLColor.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
