import SwiftUI
import UIKit
import PDFKit
import PhotosUI
import Vision
import CryptoKit
import ImageIO
import UniformTypeIdentifiers

// ScanSnap のまとめて取り込み（ネイティブ）の中身。iPad（NativeScanBulkView.swift）と iPhone（NativePhoneOwnerScanBulk.swift）で同じものを使う。
// Web の /app/scan#scan-bulk（components/scan/scan-bulk-import.tsx）と同じ流れ・同じ結果（2026-10-25 Ronnie「サブメニューのサブメニューまで全部ネイティブ」）。
//   1. ファイルアプリから（ScanSnap Home → 共有 →「ファイルに保存」）・写真アプリから（「写真に保存」）何枚でも選ぶ。HEIC・WebP は JPEG に
//   2. 中身の SHA-256 → 同じファイルはもう入っていないか（POST scanBulkCheck＝Web の checkScanDuplicate）。同じなら取り込まない
//   3. 保存ボックスへ（POST scanUpload。その日のフォルダ …/年/月/日/・contentHash。3MB を超えるものは直接アップロード）
//   4. 文字の読み取りはこの端末の中（文字入りの PDF は PDFKit の文字、写真・画像のページは Apple の Vision）。料金なし・外に送らない
//      （Web はブラウザの中の Tesseract。どちらも端末の中で読んで、読み方はサーバーの lib/receipt-read.ts の readScan だけ）
//   5. 読み取った行をサーバーへ（POST scanBulkPlan）→ サーバーが Web と同じ readScan ＋ planScanFiling（読み方は Swift に持たない）
//   6. 確かめ・直して「登録」／「まとめて登録」（POST scanBulkFile＝fileScan）
// サーバーは lib/native-modules/scan-bulk.ts（GET part=scanBulk ／ POST scanBulk*）。

// MARK: - サーバーの形

struct NSBOption: Decodable, Hashable { let value: String; let label: String }

struct NSBInfo: Decodable {
    let ok: Bool
    let storeName: String?
    let canAttach: Bool
    let today: String
    let maxFiles: Int
    let maxBytes: Int
    let inlineMaxBytes: Int
    let receiptPayments: [NSBOption]
    let billPayments: [NSBOption]
    let categories: [NSBOption]
}

/// 読み取り結果（lib/receipt-read.ts の ScanReading と同じ形）
struct NSBReading: Decodable, Equatable {
    var kind: String = "receipt"
    var category: String? = nil
    var amount: Int? = nil
    var date: String? = nil
    var vendorName: String? = nil
    var tax: Int? = nil
    var payment: String? = nil

    var json: [String: Any] {
        [
            "kind": kind,
            "category": nsbNull(category),
            "amount": nsbNull(amount),
            "date": nsbNull(date),
            "vendorName": nsbNull(vendorName),
            "tax": nsbNull(tax),
            "payment": nsbNull(payment),
        ]
    }
}

/// nil → JSON の null
func nsbNull(_ v: Any?) -> Any { v ?? NSNull() }

struct NSBCandidate: Decodable, Hashable { let id: String; let businessDate: String; let amount: Int; let label: String }

/// 登録先の案（app/app/scan/actions.ts の ScanPlan）
struct NSBPlan: Decodable {
    let reading: NSBReading
    let action: String
    let txId: String?
    let candidates: [NSBCandidate]
    let note: String
    let duplicate: String?
    let canAttach: Bool
}

/// 登録先の選択肢（lib/scan-filing-choices.ts。Web の ConfirmCard と同じ）
struct NSBChoice: Decodable, Hashable, Identifiable {
    let key: String
    let action: String
    let txId: String?
    let label: String
    let sub: String?
    var id: String { key }
}

/// 仕分けた結果（AutoFileResult）
struct NSBOutcome: Decodable { let result: String; let label: String }

private struct NSBCheckRes: Decodable { let ok: Bool; let error: String?; let duplicate: String? }
private struct NSBUploadRes: Decodable { let ok: Bool; let error: String?; let documentId: String?; let orderId: String? }
private struct NSBUrlRes: Decodable { let ok: Bool; let error: String?; let path: String?; let signedUrl: String?; let apiKey: String? }
private struct NSBPlanRes: Decodable { let ok: Bool; let error: String?; let plan: NSBPlan?; let choices: [NSBChoice]? }
private struct NSBFileRes: Decodable { let ok: Bool; let error: String?; let outcome: NSBOutcome? }

// MARK: - 1件（Web の Row と同じ状態）

enum NSBState: Equatable { case waiting, working, confirm, saving, done, failed, skipped }

struct NSBRow: Identifiable {
    let id = UUID()
    var name: String
    var state: NSBState = .waiting
    var step: String? = nil
    var docId: String? = nil
    var reading: NSBReading? = nil
    var plan: NSBPlan? = nil
    var choices: [NSBChoice] = []
    var action: String? = nil
    var txId: String? = nil
    /// 入力を直して、まだ案を出し直していない
    var dirty = false
    var planning = false
    /// 出し直しの番号（古い返事は使わない）
    var planSeq = 0
    var thumb: UIImage? = nil
    /// 大きく見る（端末の中の一時ファイル）
    var fileURL: URL? = nil
    var isPdf = false
    var pages = 1
    var outcome: NSBOutcome? = nil
    var message: String? = nil
}

/// 送るファイル（HEIC・WebP は JPEG にしたあと）
struct NSBFileData { let data: Data; let name: String; let mime: String }

/// 取り込む 1 件（名前と、中身の読み出し。ファイルアプリのファイル・写真アプリの写真）
struct NSBItem {
    let name: String
    let load: () async -> Data?
}

/// 大きく見る
struct NSBPreview: Identifiable { let id = UUID(); let url: URL; let pdf: Bool; let name: String }

// MARK: - ファイル・文字の読み取り（端末の中。裏のスレッドで動かす）

enum NSBFile {
    /// 選べる種類（Web の accept と同じ：PDF・JPEG・PNG・WebP・HEIC）
    static let types: [UTType] = [.pdf, .jpeg, .png, .heic, .heif, .webP]

    enum Kind { case pdf, jpeg, png, convert, unknown }

    /// 中身の頭の数バイトで種類を見る（無ければ拡張子）
    static func kind(_ d: Data, name: String) -> Kind {
        let b = [UInt8](d.prefix(12))
        if b.count >= 4, b[0] == 0x25, b[1] == 0x50, b[2] == 0x44, b[3] == 0x46 { return .pdf } // %PDF
        if b.count >= 3, b[0] == 0xFF, b[1] == 0xD8, b[2] == 0xFF { return .jpeg }
        if b.count >= 4, b[0] == 0x89, b[1] == 0x50, b[2] == 0x4E, b[3] == 0x47 { return .png }
        // HEIC・HEIF（…ftyp…）・WebP（RIFF….WEBP）は JPEG にしてから送る
        if b.count >= 8, b[4] == 0x66, b[5] == 0x74, b[6] == 0x79, b[7] == 0x70 { return .convert }
        if b.count >= 12, b[0] == 0x52, b[1] == 0x49, b[2] == 0x46, b[3] == 0x46, b[8] == 0x57, b[9] == 0x45, b[10] == 0x42, b[11] == 0x50 { return .convert }
        switch (name as NSString).pathExtension.lowercased() {
        case "pdf": return .pdf
        case "jpg", "jpeg": return .jpeg
        case "png": return .png
        case "heic", "heif", "webp": return .convert
        default: return .unknown
        }
    }

    /// 送るときの名前（拡張子をそろえる。HEIC・WebP は .jpg。長すぎる名前は拡張子を残して切る）
    static func name(_ name: String, kind: Kind) -> String {
        let ns = name as NSString
        let ext = ns.pathExtension.lowercased()
        var base = ns.deletingPathExtension
        var keepExt = ns.pathExtension
        switch kind {
        case .pdf: if ext != "pdf" { base = name; keepExt = "pdf" }
        case .jpeg: if ext != "jpg" && ext != "jpeg" { base = name; keepExt = "jpg" }
        case .png: if ext != "png" { base = name; keepExt = "png" }
        case .convert: keepExt = "jpg"
        case .unknown: return name
        }
        if base.isEmpty { base = "scan" }
        if base.count > 100 { base = String(base.prefix(100)) }
        return base + "." + keepExt
    }

    /// 画像を長い辺 maxPixel まで小さくする（ImageIO。どのスレッドからでも使える。写真の向きも直す）
    static func downscaled(_ data: Data, maxPixel: Int) -> CGImage? {
        guard let src = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let opts: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixel,
        ]
        return CGImageSourceCreateThumbnailAtIndex(src, 0, opts as CFDictionary)
    }

    /// iPad・iPhone の写真（HEIC）などを JPEG に（Web と同じ：長い辺は 3200px まで・画質 0.9）
    static func toJpeg(_ data: Data) -> Data? {
        guard let cg = downscaled(data, maxPixel: 3200) else { return nil }
        return UIImage(cgImage: cg).jpegData(compressionQuality: 0.9)
    }

    /// ファイルの中身の SHA-256（同じファイルの取り込み防止。Web の crypto.subtle.digest と同じ値）
    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// ファイルアプリの場所から端末の中（一時フォルダ）へ写す（選んだ場所は、そのあいだだけ読める）
    static func copyIn(_ url: URL, to dir: URL) -> URL? {
        let ok = url.startAccessingSecurityScopedResource()
        defer { if ok { url.stopAccessingSecurityScopedResource() } }
        let dest = dir.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent)
        do {
            try FileManager.default.copyItem(at: url, to: dest)
            return dest
        } catch {
            guard let d = try? Data(contentsOf: url) else { return nil }
            do { try d.write(to: dest); return dest } catch { return nil }
        }
    }

    static func writeTemp(_ data: Data, ext: String, dir: URL) -> URL? {
        let dest = dir.appendingPathComponent(UUID().uuidString + "." + ext)
        do { try data.write(to: dest); return dest } catch { return nil }
    }

    /// 裏のスレッドで動かして結果を返す（resume は 1 回だけ）
    static func background<T>(_ work: @escaping @Sendable () -> T) async -> T {
        await withCheckedContinuation { (cont: CheckedContinuation<T, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let r = work()
                cont.resume(returning: r)
            }
        }
    }

    struct Read { var lines: [String]; var pages: Int; var thumb: Data? }

    /// 文字を読む（PDF：最初の2ページ。文字の入ったページはその文字、文字の無いページは画像にして Vision。画像：Vision）
    static func readText(_ data: Data, pdf: Bool) async -> Read {
        await background { pdf ? NSBFile.readPdf(data) : NSBFile.readImage(data) }
    }

    static func readPdf(_ data: Data) -> Read {
        guard let doc = PDFDocument(data: data) else { return Read(lines: [], pages: 1, thumb: nil) }
        let count = doc.pageCount
        var lines: [String] = []
        var thumb: Data?
        // レシート・請求書は1〜2ページ目に金額がある。長い PDF は最初の2ページだけ読む（Web と同じ）
        for i in 0..<min(count, 2) {
            guard let page = doc.page(at: i) else { continue }
            let size = pageSize(page)
            if i == 0, size.width > 0, size.height > 0 {
                let t = page.thumbnail(of: CGSize(width: 240, height: 240 * size.height / size.width), for: .mediaBox)
                thumb = t.jpegData(compressionQuality: 0.75)
            }
            // ScanSnap の「検索可能な PDF」は文字が入っているのでそのまま。文字が無いページは画像にして読む
            let textLines = pdfTextLines(page)
            if textLines.joined().filter({ !$0.isWhitespace }).count >= 15 {
                lines += textLines
                continue
            }
            guard size.width > 0, size.height > 0 else { continue }
            let img = page.thumbnail(of: CGSize(width: size.width * 2.2, height: size.height * 2.2), for: .mediaBox)
            if let cg = img.cgImage {
                lines += ocrLines(cg, orientation: .up, width: CGFloat(cg.width), height: CGFloat(cg.height))
            }
        }
        return Read(lines: lines, pages: max(count, 1), thumb: thumb)
    }

    static func readImage(_ data: Data) -> Read {
        guard let img = UIImage(data: data), let cg = img.cgImage else { return Read(lines: [], pages: 1, thumb: nil) }
        // 向きを直したあとの大きさ（Vision の位置は向きを直した画像の中の割合）
        let w = img.size.width * img.scale
        let h = img.size.height * img.scale
        let lines = ocrLines(cg, orientation: cgOrientation(img.imageOrientation), width: w, height: h)
        let thumb = downscaled(data, maxPixel: 360).flatMap { UIImage(cgImage: $0).jpegData(compressionQuality: 0.75) }
        return Read(lines: lines, pages: 1, thumb: thumb)
    }

    /// 回転を入れたページの大きさ
    static func pageSize(_ page: PDFPage) -> CGSize {
        let box = page.bounds(for: .mediaBox)
        return abs(page.rotation) % 180 == 90 ? CGSize(width: box.height, height: box.width) : box.size
    }

    /// PDF の文字 → 行（Web の pdfTextLines と同じ並べ方：同じ高さは同じ行・離れた文字のあいだは空白）
    static func pdfTextLines(_ page: PDFPage) -> [String] {
        // 回転したページは位置で並べられないので、PDFKit の文字の並びのまま
        if abs(page.rotation) % 180 == 90 { return (page.string ?? "").components(separatedBy: .newlines) }
        var pieces: [NSBPiece] = []
        if let sel = page.selection(for: page.bounds(for: .mediaBox)) {
            for line in sel.selectionsByLine() {
                guard let s = line.string?.trimmingCharacters(in: .newlines), !s.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
                let b = line.bounds(for: page)
                pieces.append(NSBPiece(text: s, x: b.minX, y: b.midY, w: b.width, h: b.height))
            }
        }
        if pieces.isEmpty { return (page.string ?? "").components(separatedBy: .newlines) }
        return groupLines(pieces)
    }

    /// Vision で文字を読む。完了ハンドラは使わず、perform の後に結果を読む（NativeMenuScanView と同じ。呼ぶのは裏のスレッド）
    static func ocrLines(_ cg: CGImage, orientation: CGImagePropertyOrientation, width: CGFloat, height: CGFloat) -> [String] {
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.recognitionLanguages = ["ja-JP", "en-US"]
        req.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation)
        do {
            try handler.perform([req])
        } catch {
            return []
        }
        let obs: [VNRecognizedTextObservation] = req.results ?? []
        let pieces: [NSBPiece] = obs.compactMap { o -> NSBPiece? in
            guard let t = o.topCandidates(1).first?.string, !t.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            let b = o.boundingBox
            return NSBPiece(text: t, x: b.minX * width, y: b.midY * height, w: b.width * width, h: b.height * height)
        }
        return groupLines(pieces)
    }

    /// 位置から行にする（Web の pdfTextLines と同じ：上から下、同じ高さ＝高さの半分以内は同じ行、
    /// 左から右へ、文字の高さの 1/4 より広いすき間には空白）。y は上ほど大きい（PDF・Vision とも左下が 0）
    static func groupLines(_ pieces: [NSBPiece]) -> [String] {
        let sorted = pieces.sorted { a, b in a.y != b.y ? a.y > b.y : a.x < b.x }
        var rows: [(y: CGFloat, h: CGFloat, parts: [NSBPiece])] = []
        for p in sorted {
            if let i = rows.firstIndex(where: { abs($0.y - p.y) <= max($0.h, p.h) * 0.5 }) {
                rows[i].parts.append(p)
            } else {
                rows.append((y: p.y, h: p.h, parts: [p]))
            }
        }
        rows.sort { $0.y > $1.y }
        return rows.map { r -> String in
            var line = ""
            var end: CGFloat? = nil
            for p in r.parts.sorted(by: { $0.x < $1.x }) {
                if let e = end, p.x - e > p.h * 0.25 { line += " " }
                line += p.text
                end = p.x + p.w
            }
            return line.trimmingCharacters(in: .whitespaces)
        }
    }

    static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

/// 文字のかたまり（位置つき）
struct NSBPiece { let text: String; let x: CGFloat; let y: CGFloat; let w: CGFloat; let h: CGFloat }

// MARK: - 表示のことば（iPad・iPhone で同じ。Web と同じ書き方）

enum NSBText {
    private static let yenFormat: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.locale = Locale(identifier: "ja_JP")
        return f
    }()

    /// 入力欄の数字（Web の num と同じ：空なら null、数字だけ取り出す）
    static func num(_ v: String) -> Int? {
        if v.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
        let digits = String(v.filter { $0.isASCII && $0.isNumber }.prefix(12))
        return Int(digits) ?? 0
    }

    /// 3,280（入力欄。空は ""）
    static func yen(_ n: Int?) -> String {
        guard let n else { return "" }
        return yenFormat.string(from: NSNumber(value: n)) ?? String(n)
    }

    /// 'YYYY-MM-DD' → '10/25'
    static func md(_ d: String) -> String {
        "\(Int(d.dropFirst(5).prefix(2)) ?? 0)/\(Int(d.suffix(2)) ?? 0)"
    }

    /// 一覧の 1 行の右の字（Web と同じ）
    static func status(_ r: NSBRow) -> String {
        switch r.state {
        case .waiting: return "待機中"
        case .working: return r.step ?? "処理中"
        case .skipped, .failed: return r.message ?? ""
        case .done:
            guard let o = r.outcome else { return "" }
            let prefix: String
            switch o.result {
            case "attached": prefix = "出金に紐付け："
            case "receipt": prefix = "レシート："
            case "vendor_bill": prefix = "月払い（請求書）："
            case "fixed_bill": prefix = "月払い："
            default: prefix = "保存ボックス："
            }
            return prefix + o.label
        case .confirm, .saving: return ""
        }
    }

    /// 取り込みの手順（Web の ol と同じ）
    static let steps = [
        "ScanSnap Home でレシート・請求書をスキャン（1日に何回に分けても同じ日のフォルダにまとまります）",
        "共有 →「ファイルに保存」（写真アプリに保存したときは「写真から選ぶ」）",
        "ここで「ファイルから選ぶ」→ まとめて選ぶ（PDF・JPEG・PNG・HEIC）",
        "読み取った金額・消費税・日付・支払い方法を確かめて「登録」。同じファイルは取り込みません",
    ]
}

// MARK: - 画面の中身

@MainActor
final class NativeScanBulkModel: ObservableObject {
    @Published var info: NSBInfo?
    @Published var loadError: String?
    /// サーバーが「Web で」と言った（会計の機能が切ってあるなど）
    @Published var useWeb = false
    @Published var rows: [NSBRow] = []
    @Published var running = false
    /// 選んだファイルを端末の中へ写している（たくさん選んだとき）
    @Published var preparing = false
    @Published var savingAll = false
    @Published var savingDone = 0
    @Published var savingTotal = 0
    @Published var folderDay: String?

    private var seenHashes = Set<String>()
    private var replanTasks: [UUID: Task<Void, Never>] = [:]
    /// 選んだファイルの写し・大きく見る用（次に選ぶときに消す。tmp は iOS も片づける）
    private let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("scan-bulk", isDirectory: true)

    private static let stampFormat: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd_HHmmss"
        f.timeZone = TimeZone(identifier: "Asia/Tokyo")
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()

    func load() async {
        if NativePreview.current != nil { return }
        if info == nil, let saved = NativeModuleAPI.cached(NSBInfo.self, part: "scanBulk") { info = saved }
        do {
            info = try await NativeModuleAPI.get(NSBInfo.self, part: "scanBulk")
            loadError = nil
        } catch {
            if let e = error as? NativeAPIError, e.useWeb { useWeb = true }
            if info == nil { loadError = NativeModuleAPI.message(error) }
        }
    }

    // MARK: 一覧の数え方（Web と同じ）

    var confirmRows: [NSBRow] { rows.filter { $0.state == .confirm || $0.state == .saving } }
    var ready: [NSBRow] { rows.filter { $0.state == .confirm && !$0.planning && $0.action != nil && ($0.action != "attach" || $0.txId != nil) } }
    var finished: Bool { !running && !rows.isEmpty && confirmRows.isEmpty }
    func count(_ result: String) -> Int { rows.filter { $0.state == .done && $0.outcome?.result == result }.count }
    var failedCount: Int { rows.filter { $0.state == .failed }.count }
    var skippedCount: Int { rows.filter { $0.state == .skipped }.count }
    /// 取り込みの済んだ数（確かめ待ち・登録済み・取り込まなかった・失敗）
    var handledCount: Int { rows.filter { $0.state != .waiting && $0.state != .working }.count }
    var busy: Bool { running || savingAll }

    /// 進み具合（取り込み中・まとめて登録中）。nil なら出さない
    var progress: (text: String, value: Double, total: Double)? {
        if running {
            let total = max(rows.count, 1)
            if preparing { return (text: "ファイルを読み込んでいます…", value: 0, total: Double(total)) }
            let step = rows.first { $0.state == .working }?.step ?? ""
            let text = "取り込み中 \(min(handledCount + 1, rows.count))/\(rows.count)件" + (step.isEmpty ? "" : "・\(step)")
            return (text: text, value: Double(handledCount), total: Double(total))
        }
        if savingAll {
            let text = "登録中 \(min(savingDone + 1, savingTotal))/\(savingTotal)件"
            return (text: text, value: Double(savingDone), total: Double(max(savingTotal, 1)))
        }
        return nil
    }

    /// 終わったときの数（Web と同じ書き方）
    var summaryText: String {
        let monthly = count("vendor_bill") + count("fixed_bill")
        let box = count("review") + failedCount
        var text = "出金に紐付け \(count("attached"))件 ・ レシート \(count("receipt"))件 ・ 月払い \(monthly)件 ・ 保存ボックス \(box)件"
        if skippedCount > 0 { text += " ・ 取り込み済み \(skippedCount)件" }
        return text
    }

    private var maxFiles: Int { info?.maxFiles ?? 50 }

    private func index(_ id: UUID) -> Int? { rows.firstIndex { $0.id == id } }
    private func patch(_ id: UUID, _ f: (inout NSBRow) -> Void) {
        if let i = index(id) { f(&rows[i]) }
    }
    private func fail(_ id: UUID, _ message: String) { patch(id) { $0.state = .failed; $0.step = nil; $0.message = message } }
    private func skip(_ id: UUID, _ message: String) { patch(id) { $0.state = .skipped; $0.step = nil; $0.message = message } }

    /// 前の取り込みの一時ファイルを消して、新しく始める
    private func begin(names: [String]) -> URL {
        let dir = tempDir
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        replanTasks.values.forEach { $0.cancel() }
        replanTasks = [:]
        rows = names.map { NSBRow(name: $0) }
        seenHashes = []
        folderDay = NPDate.str(Date())
        return dir
    }

    // MARK: 取り込み（1件ずつ順に。Web の run と同じ）

    /// ファイルアプリから選んだファイル（ScanSnap Home →「ファイルに保存」）
    func run(files urls: [URL]) async {
        guard !running, !savingAll, !urls.isEmpty else { return }
        running = true
        defer { running = false; preparing = false }
        let list = Array(urls.prefix(maxFiles))
        let dir = begin(names: list.map(\.lastPathComponent))
        // 選んだ場所は今だけ読めるので、先に端末の中へ写す
        preparing = true
        let copies: [URL?] = await NSBFile.background { list.map { NSBFile.copyIn($0, to: dir) } }
        preparing = false
        let items = zip(list, copies).map { (url, copy) -> NSBItem in
            NSBItem(name: url.lastPathComponent, load: {
                guard let copy else { return nil }
                return await NSBFile.background { try? Data(contentsOf: copy) }
            })
        }
        await processAll(items)
    }

    /// 写真アプリから選んだ写真（ScanSnap Home →「写真に保存」）。名前は写真_日時_番号
    func run(photos picks: [PhotosPickerItem]) async {
        guard !running, !savingAll, !picks.isEmpty else { return }
        running = true
        defer { running = false; preparing = false }
        let stamp = Self.stampFormat.string(from: Date())
        let list = Array(picks.prefix(maxFiles))
        let items = list.enumerated().map { (i, item) -> NSBItem in
            let ext = item.supportedContentTypes.first?.preferredFilenameExtension ?? "jpg"
            return NSBItem(name: "photo_\(stamp)_\(i + 1).\(ext)", load: { try? await item.loadTransferable(type: Data.self) })
        }
        _ = begin(names: items.map(\.name))
        await processAll(items)
    }

    private func processAll(_ items: [NSBItem]) async {
        let ids = rows.map(\.id)
        for (i, id) in ids.enumerated() where i < items.count {
            patch(id) { $0.state = .working; $0.step = "確かめています" }
            await process(id, items[i])
        }
    }

    private func process(_ id: UUID, _ item: NSBItem) async {
        let name = item.name
        guard let raw = await item.load(), !raw.isEmpty else {
            fail(id, "ファイルを開けませんでした")
            return
        }
        // 1. 種類を確かめる。iPad・iPhone の写真（HEIC）・WebP は JPEG にしてから
        let kind = NSBFile.kind(raw, name: name)
        let file: NSBFileData
        switch kind {
        case .pdf: file = NSBFileData(data: raw, name: NSBFile.name(name, kind: kind), mime: "application/pdf")
        case .jpeg: file = NSBFileData(data: raw, name: NSBFile.name(name, kind: kind), mime: "image/jpeg")
        case .png: file = NSBFileData(data: raw, name: NSBFile.name(name, kind: kind), mime: "image/png")
        case .convert:
            patch(id) { $0.step = "HEIC を JPEG にしています" }
            guard let jpeg = await NSBFile.background({ NSBFile.toJpeg(raw) }) else {
                fail(id, "HEIC の写真を開けませんでした。JPEG で保存してから選んでください")
                return
            }
            file = NSBFileData(data: jpeg, name: NSBFile.name(name, kind: kind), mime: "image/jpeg")
        case .unknown:
            fail(id, "PDF・PNG・JPEG・WebPのみアップロードできます")
            return
        }
        if file.data.count > (info?.maxBytes ?? 20 * 1024 * 1024) {
            fail(id, "ファイルサイズは20MBまでです")
            return
        }
        patch(id) { $0.name = file.name }
        // 2. 同じファイル（中身が同じ）は取り込まない
        let data = file.data
        let hash = await NSBFile.background { NSBFile.sha256(data) }
        if seenHashes.contains(hash) {
            skip(id, "同じファイルを2回選んでいます")
            return
        }
        seenHashes.insert(hash)
        if let dup = await checkDuplicate(hash: hash, name: file.name, size: file.data.count) {
            skip(id, dup)
            return
        }
        // 3. 保存ボックスへ（その日のフォルダ）
        patch(id) { $0.step = "アップロードしています" }
        let docId: String
        do {
            docId = try await upload(file, hash: hash)
        } catch {
            fail(id, NativeModuleAPI.message(error))
            return
        }
        // 4. 文字の読み取り（この端末の中）
        patch(id) { $0.step = "文字を読み取っています" }
        let isPdf = file.mime == "application/pdf"
        let read = await NSBFile.readText(file.data, pdf: isPdf)
        let ext = isPdf ? "pdf" : (file.mime == "image/png" ? "png" : "jpg")
        let dir = tempDir
        let previewURL = await NSBFile.background { NSBFile.writeTemp(data, ext: ext, dir: dir) }
        // 5. 登録先の案（読み方・案はサーバー。Web と同じ readScan・planScanFiling）
        patch(id) { $0.step = "登録先を考えています" }
        do {
            let (plan, choices) = try await requestPlan(["type": "scanBulkPlan", "documentId": docId, "lines": read.lines])
            let thumb = read.thumb.flatMap { UIImage(data: $0) }
            patch(id) { row in
                row.state = .confirm
                row.step = nil
                row.docId = docId
                row.reading = plan.reading
                row.plan = plan
                row.choices = choices
                row.action = plan.action
                row.txId = plan.txId
                row.pages = read.pages
                row.thumb = thumb
                row.fileURL = previewURL
                row.isPdf = isPdf
            }
        } catch {
            // 書類は保存ボックスに入っている（Web と同じ：保存ボックスで仕分けられる）
            fail(id, NativeModuleAPI.message(error))
        }
    }

    /// 取り込む前の重複チェック。確かめられなかったときは取り込む（Web と同じ）
    private func checkDuplicate(hash: String, name: String, size: Int) async -> String? {
        do {
            let r: NSBCheckRes = try await Self.post(["type": "scanBulkCheck", "hash": hash, "fileName": name, "sizeBytes": size])
            return r.ok ? r.duplicate : nil
        } catch {
            return nil
        }
    }

    /// 3MB までは scanUpload（撮影と同じ道。dayFolder・contentHash）、それより大きいものは保存ボックスへ直接上げてから登録
    private func upload(_ f: NSBFileData, hash: String) async throws -> String {
        if f.data.count <= (info?.inlineMaxBytes ?? 3_000_000) {
            let body: [String: Any] = [
                "type": "scanUpload", "fileName": f.name, "mimeType": f.mime, "dataBase64": f.data.base64EncodedString(),
                "txId": NSNull(), "contentHash": hash, "dayFolder": true,
            ]
            let r: NSBUploadRes = try await Self.post(body, timeout: 120)
            guard r.ok, let id = r.documentId ?? r.orderId else { throw NativeAPIError(message: r.error ?? "アップロードできませんでした", useWeb: false) }
            return id
        }
        let u: NSBUrlRes = try await Self.post(["type": "scanBulkUploadUrl", "fileName": f.name, "mimeType": f.mime, "sizeBytes": f.data.count])
        guard u.ok, let path = u.path, let s = u.signedUrl, let signed = URL(string: s) else {
            throw NativeAPIError(message: u.error ?? "アップロードできませんでした", useWeb: false)
        }
        var req = URLRequest(url: signed)
        req.httpMethod = "PUT"
        req.timeoutInterval = 180
        req.setValue(f.mime, forHTTPHeaderField: "content-type")
        req.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        req.setValue("false", forHTTPHeaderField: "x-upsert")
        if let k = u.apiKey, !k.isEmpty { req.setValue(k, forHTTPHeaderField: "apikey") }
        let (_, resp) = try await URLSession.shared.upload(for: req, from: f.data)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw NativeAPIError(message: "アップロードできませんでした", useWeb: false)
        }
        let reg: NSBUploadRes = try await Self.post([
            "type": "scanBulkRegister", "path": path, "fileName": f.name, "mimeType": f.mime, "sizeBytes": f.data.count, "contentHash": hash,
        ])
        guard reg.ok, let id = reg.documentId else { throw NativeAPIError(message: reg.error ?? "登録に失敗しました", useWeb: false) }
        return id
    }

    private func requestPlan(_ body: [String: Any]) async throws -> (NSBPlan, [NSBChoice]) {
        let r: NSBPlanRes = try await Self.post(body)
        guard r.ok, let p = r.plan else { throw NativeAPIError(message: r.error ?? "確かめられませんでした", useWeb: false) }
        return (p, r.choices ?? [])
    }

    private static func post<T: Decodable>(_ body: [String: Any], timeout: TimeInterval = 60) async throws -> T {
        var req = URLRequest(url: AppConfig.url("/api/app/v1/pos"))
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await NativeAPI.shared.send(req, kickPrint: false)
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: 確かめ・直し（Web の ConfirmCard と同じ）

    /// 入力を直す。now＝すぐ案を出し直す（種類・支払い・費目）。それ以外は直しただけ（欄を離れたら出し直す）
    func edit(_ id: UUID, now: Bool, _ f: (inout NSBReading) -> Void) {
        guard let i = index(id), var r = rows[i].reading else { return }
        f(&r)
        if now {
            replan(id, r)
        } else {
            rows[i].reading = r
            rows[i].dirty = true
        }
    }

    /// 欄を離れた：直していれば案を出し直す
    func blur(_ id: UUID) {
        guard let i = index(id), rows[i].dirty, rows[i].state == .confirm, let r = rows[i].reading else { return }
        replan(id, r)
    }

    /// 日付を選んだ：少し待ってから案を出し直す（続けて選んでいるあいだは出し直さない）
    func scheduleReplan(_ id: UUID) {
        replanTasks[id]?.cancel()
        replanTasks[id] = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if Task.isCancelled { return }
            self?.blur(id)
        }
    }

    /// 直した内容で登録先の案を出し直す
    func replan(_ id: UUID, _ reading: NSBReading) {
        guard let i = index(id), let docId = rows[i].docId else { return }
        rows[i].planSeq += 1
        let seq = rows[i].planSeq
        rows[i].planning = true
        rows[i].reading = reading
        rows[i].dirty = false
        rows[i].message = nil
        if NativePreview.current != nil { rows[i].planning = false; return }
        Task { @MainActor in
            do {
                let (plan, choices) = try await self.requestPlan(["type": "scanBulkPlan", "documentId": docId, "reading": reading.json])
                self.patch(id) { row in
                    guard row.planSeq == seq else { return }
                    row.planning = false
                    row.plan = plan
                    row.choices = choices
                    row.action = plan.action
                    row.txId = plan.txId
                }
            } catch {
                let message = NativeModuleAPI.message(error)
                self.patch(id) { row in
                    guard row.planSeq == seq else { return }
                    row.planning = false
                    row.message = message
                }
            }
        }
    }

    func choose(_ id: UUID, action: String, txId: String?) {
        patch(id) { $0.action = action; $0.txId = txId }
    }

    /// 登録（fileScan）。keep を渡すと「あとで」（保存ボックスに残す）
    @discardableResult
    func register(_ id: UUID, action forced: String? = nil) async -> Bool {
        guard let i = index(id), let docId = rows[i].docId, let reading = rows[i].reading else { return false }
        if let forced {
            rows[i].action = forced
            rows[i].txId = nil
        }
        guard let action = rows[i].action else { return false }
        let txId = rows[i].txId
        let wasDirty = rows[i].dirty
        replanTasks[id]?.cancel()
        // 出し直しの途中の返事は使わない（直した内容のまま登録する。Web と同じ）
        rows[i].planSeq += 1
        rows[i].planning = false
        rows[i].dirty = false
        rows[i].state = .saving
        rows[i].message = nil
        if NativePreview.current != nil { return false }
        do {
            let r: NSBFileRes = try await Self.post(["type": "scanBulkFile", "documentId": docId, "reading": reading.json, "action": action, "txId": nsbNull(txId)])
            guard r.ok, let outcome = r.outcome else { throw NativeAPIError(message: r.error ?? "登録できませんでした", useWeb: false) }
            patch(id) { $0.state = .done; $0.outcome = outcome }
            return true
        } catch {
            let message = NativeModuleAPI.message(error)
            patch(id) { $0.state = .confirm; $0.dirty = wasDirty; $0.message = message }
            return false
        }
    }

    /// まとめて登録（登録できるものを順に。Web と同じく、ほかのファイルを読み取っているあいだも押せる）
    func registerAll() async {
        guard !savingAll else { return }
        let ids = ready.map(\.id)
        guard !ids.isEmpty else { return }
        savingAll = true
        savingTotal = ids.count
        savingDone = 0
        for id in ids {
            await register(id)
            savingDone += 1
        }
        savingAll = false
    }

    // MARK: 表示

    func paymentLabel(_ p: String?, receipt: Bool) -> String {
        guard let p else { return receipt ? "わからない（現金）" : "わからない" }
        let all = (info?.receiptPayments ?? []) + (info?.billPayments ?? [])
        return all.first { $0.value == p }?.label ?? p
    }

    func categoryLabel(_ c: String?) -> String {
        let v = c ?? "vendor"
        return info?.categories.first { $0.value == v }?.label ?? v
    }
}

// MARK: - 大きく見る（PDF は PDFKit、写真はそのまま。iPad・iPhone で同じ）

struct NSBPreviewView: View {
    let item: NSBPreview
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text(item.name).font(.system(size: 14, weight: .semibold)).foregroundColor(.white).lineLimit(1).truncationMode(.middle)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 17, weight: .bold)).foregroundColor(.white)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Color.white.opacity(0.15)))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("閉じる")
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 16).padding(.bottom, 16)
        }
        .background(Color.black.opacity(0.88).ignoresSafeArea())
    }

    @ViewBuilder private var content: some View {
        if item.pdf {
            NSBPDFView(url: item.url)
        } else if let img = UIImage(contentsOfFile: item.url.path) {
            ScrollView { Image(uiImage: img).resizable().scaledToFit() }
        } else {
            Text("開けませんでした").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink3)
        }
    }
}

struct NSBPDFView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.displayMode = .singlePageContinuous
        v.displayDirection = .vertical
        v.document = PDFDocument(url: url)
        return v
    }
    func updateUIView(_ v: PDFView, context: Context) {}
}
