import SwiftUI
import PhotosUI
import PDFKit
import Vision
import UniformTypeIdentifiers

// 写真・PDFからメニューを登録（Web の /app/settings/menu/scan・components/settings/menu-scan-import.tsx と同じ流れ）。
// 2026-10-24 23:43 Ronnie「サブメニューのサブメニューまで全部ネイティブ」。
// 文字の読み取りは iPad の中（Apple の Vision。お金はかからない・ネットに写真を送らない）。
// 読み取った行 → 商品に分けるのはサーバーの parseMenuLines（Web と同じ決め方。POST menuScanParse）。
// 登録はデータ取込と同じ importRun（menu_items。権限 org.settings はサーバーで確かめる）。

struct NMSRow: Identifiable, Hashable {
    let id = UUID()
    var on = true
    var categoryName: String
    var name: String
    var nameEn: String
    var price: String
    var itemType: String // food / drink
}

private struct NMSParsed: Decodable {
    let categoryName: String
    let name: String
    let nameEn: String
    let price: Double
    let itemType: String
}

@MainActor
final class NativeMenuScanModel: ObservableObject {
    @Published var toast: String?
    @Published var busy: String?
    @Published var text = ""
    @Published var rows: [NMSRow]?
    @Published var result: NIMResult?
    @Published var importing = false

    /// 写真（複数）・PDF を読み取る
    func read(images: [UIImage], pdfs: [URL]) async {
        guard busy == nil else { return }
        result = nil
        var lines: [String] = []
        let total = images.count + pdfs.count
        var n = 0
        for img in images {
            n += 1
            busy = total > 1 ? "\(n)/\(total)枚目の文字を読み取っています…" : "文字を読み取っています…"
            lines += await Self.ocr(img)
            lines.append("")
        }
        for url in pdfs {
            n += 1
            let ok = url.startAccessingSecurityScopedResource()
            defer { if ok { url.stopAccessingSecurityScopedResource() } }
            guard let doc = PDFDocument(url: url) else { toast = "PDF を開けませんでした"; continue }
            for i in 0..<doc.pageCount {
                guard let page = doc.page(at: i) else { continue }
                busy = "\(url.lastPathComponent) \(i + 1)ページを読み取っています…"
                // 文字が入っている PDF はそのまま。文字が無い（写真・スキャン）ページは画像にして読み取る（Web と同じ）
                let s = page.string ?? ""
                if s.replacingOccurrences(of: "\\s", with: "", options: .regularExpression).count >= 20 {
                    lines += s.components(separatedBy: .newlines)
                } else {
                    let box = page.bounds(for: .mediaBox)
                    let scale: CGFloat = 2.5
                    let img = page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .mediaBox)
                    lines += await Self.ocr(img)
                }
                lines.append("")
            }
        }
        busy = nil
        text = lines.joined(separator: "\n").replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        await parse(lines, first: true)
    }

    /// 下の文字を直して「読み直す」
    func reparse() async { await parse(text.components(separatedBy: "\n"), first: false) }

    private func parse(_ lines: [String], first: Bool) async {
        busy = "商品に分けています…"
        defer { busy = nil }
        let r = await NSPApi.postJSON(["type": "menuScanParse", "lines": Array(lines.prefix(5000))])
        guard r.ok, let raw = r.json?["rows"], let d = try? JSONSerialization.data(withJSONObject: raw),
              let parsed = try? JSONDecoder().decode([NMSParsed].self, from: d) else {
            toast = r.error ?? "商品に分けられませんでした"
            return
        }
        rows = parsed.map { NMSRow(categoryName: $0.categoryName, name: $0.name, nameEn: $0.nameEn, price: String(Int($0.price.rounded())), itemType: $0.itemType == "drink" ? "drink" : "food") }
        if first {
            toast = parsed.isEmpty ? "商品を読み取れませんでした。下の文字を直して「読み直す」か、行を足してください" : "\(parsed.count)件の商品を読み取りました。確認してから登録してください"
        } else {
            toast = "\(parsed.count)件の商品を読み直しました"
        }
    }

    var selected: [NMSRow] {
        (rows ?? []).filter { $0.on && !$0.name.trimmingCharacters(in: .whitespaces).isEmpty && Int($0.price) != nil && (Int($0.price) ?? -1) >= 0 }
    }

    func register() async {
        let list = selected
        guard !list.isEmpty, !importing else { return }
        importing = true
        defer { importing = false }
        let payload: [[String: Any]] = list.enumerated().map { i, r in
            ["rowNumber": i + 1, "values": [
                "categoryName": r.categoryName.trimmingCharacters(in: .whitespaces),
                "name": r.name.trimmingCharacters(in: .whitespaces),
                "nameEn": r.nameEn.trimmingCharacters(in: .whitespaces),
                "price": String(Int(r.price) ?? 0),
                "itemType": r.itemType,
            ]]
        }
        let r = await NSPApi.postJSON(["type": "importRun", "importType": "menu_items", "rows": payload])
        guard r.ok, let res = r.json?["result"], let d = try? JSONSerialization.data(withJSONObject: res),
              let decoded = try? JSONDecoder().decode(NIMResult.self, from: d) else {
            toast = r.error ?? "登録できませんでした"
            return
        }
        result = decoded
        toast = "\(decoded.inserted)件をメニューに登録しました"
    }

    func reset() { text = ""; rows = nil; result = nil }

    /// Vision で文字を読む。同じ高さの文字は 1 行にまとめる（2 列のメニューは「名前 価格 名前 価格」の 1 行になる＝Web と同じ形）
    nonisolated static func ocr(_ image: UIImage) async -> [String] {
        guard let cg = image.cgImage else { return [] }
        let orientation = cgOrientation(image.imageOrientation)
        return await withCheckedContinuation { (cont: CheckedContinuation<[String], Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                // 完了ハンドラは使わず、perform の後に結果を読む（resume は必ず 1 回だけ）
                let req = VNRecognizeTextRequest()
                req.recognitionLevel = .accurate
                req.recognitionLanguages = ["ja-JP", "en-US"]
                req.usesLanguageCorrection = true
                let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation)
                do {
                    try handler.perform([req])
                } catch {
                    cont.resume(returning: [])
                    return
                }
                let obs: [VNRecognizedTextObservation] = req.results ?? []
                let pieces: [(text: String, box: CGRect)] = obs.compactMap { o in
                    guard let t = o.topCandidates(1).first?.string, !t.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
                    return (text: t, box: o.boundingBox)
                }
                cont.resume(returning: groupLines(pieces))
            }
        }
    }

    /// 位置（Vision は左下が 0・上が 1）から行にする：上から下、同じ高さ（高さの半分以内）は左から右へ空白でつなぐ
    nonisolated static func groupLines(_ pieces: [(text: String, box: CGRect)]) -> [String] {
        let sorted = pieces.sorted { a, b in
            if abs(a.box.midY - b.box.midY) > 0.0001 { return a.box.midY > b.box.midY }
            return a.box.minX < b.box.minX
        }
        var rows: [(midY: CGFloat, h: CGFloat, parts: [(text: String, box: CGRect)])] = []
        for p in sorted {
            if let i = rows.firstIndex(where: { abs($0.midY - p.box.midY) <= max($0.h, p.box.height) * 0.5 }) {
                rows[i].parts.append(p)
            } else {
                rows.append((midY: p.box.midY, h: p.box.height, parts: [p]))
            }
        }
        rows.sort { $0.midY > $1.midY }
        return rows.map { r in r.parts.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: " ") }
    }

    nonisolated private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
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

struct NativeMenuScanScreen: View {
    @StateObject private var model = NativeMenuScanModel()
    @EnvironmentObject var state: AppState
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var showFiles = false

    var body: some View {
        NSPFrame(storeName: "", title: "写真・PDFからメニューを登録", en: "Scan menu", loaded: true, error: nil, toast: $model.toast, onBack: { state.goNativeSettings() }, retry: {}) {
            pickCard
            if let busy = model.busy {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(busy).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink2)
                }
                .padding(18)
            }
            if let res = model.result { resultCard(res) }
            if model.rows != nil { rowsCard }
            if !model.text.isEmpty { textCard }
        }
        .onChange(of: photoItems) { items in
            guard !items.isEmpty else { return }
            Task {
                var imgs: [UIImage] = []
                for it in items {
                    if let d = try? await it.loadTransferable(type: Data.self), let img = UIImage(data: d) { imgs.append(img) }
                }
                photoItems = []
                await model.read(images: imgs, pdfs: [])
            }
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { r in
            guard case .success(let urls) = r else { return }
            Task {
                var imgs: [UIImage] = []
                var pdfs: [URL] = []
                for u in urls {
                    if u.pathExtension.lowercased() == "pdf" { pdfs.append(u); continue }
                    let ok = u.startAccessingSecurityScopedResource()
                    if let d = try? Data(contentsOf: u), let img = UIImage(data: d) { imgs.append(img) }
                    if ok { u.stopAccessingSecurityScopedResource() }
                }
                await model.read(images: imgs, pdfs: pdfs)
            }
        }
    }

    private var pickCard: some View {
        NSPCard(title: "メニューの写真か PDF を選ぶ", en: "商品名・価格を読み取って表にします。確認してから登録します") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    PhotosPicker(selection: $photoItems, maxSelectionCount: 20, matching: .images) {
                        HStack(spacing: 6) { Image(systemName: "photo.on.rectangle"); Text("写真を選ぶ") }
                            .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                            .padding(.horizontal, 16).frame(height: 44)
                            .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.navy))
                    }
                    .disabled(model.busy != nil)
                    NSPButton(text: "PDF・ファイルを選ぶ", icon: "doc.text", disabled: model.busy != nil) { showFiles = true }
                    if model.rows != nil { NSPButton(text: "やり直す", icon: "arrow.counterclockwise") { model.reset() } }
                }
                Text("文字の読み取りはこの iPad の中で行います（写真は外へ送りません）。はっきり・まっすぐ撮った写真ほど正確です")
                    .font(.system(size: 12.5)).foregroundColor(NFColor.ink3)
            }
            .padding(18)
        }
    }

    private var rowsCard: some View {
        let count = model.selected.count
        return NSPCard(title: "読み取った商品（\(model.rows?.count ?? 0)件）", en: "チェックを外した行は登録しません") {
            VStack(spacing: 0) {
                ForEach(Array((model.rows ?? []).enumerated()), id: \.element.id) { i, _ in rowView(i) }
                HStack(spacing: 10) {
                    NSPButton(text: "行を足す", icon: "plus") {
                        model.rows = (model.rows ?? []) + [NMSRow(categoryName: model.rows?.last?.categoryName ?? "メニュー", name: "", nameEn: "", price: "", itemType: "food")]
                    }
                    Spacer()
                    NSPButton(text: count > 0 ? "\(count)件をメニューに登録" : "登録する行がありません", icon: "square.and.arrow.down", primary: true, busy: model.importing, disabled: count == 0) {
                        Task { await model.register() }
                    }
                }
                .padding(18)
            }
        }
    }

    private func binding(_ i: Int, _ kp: WritableKeyPath<NMSRow, String>) -> Binding<String> {
        Binding(get: { (model.rows ?? []).indices.contains(i) ? model.rows![i][keyPath: kp] : "" },
                set: { v in if (model.rows ?? []).indices.contains(i) { model.rows![i][keyPath: kp] = v } })
    }

    private func rowView(_ i: Int) -> some View {
        let r = model.rows![i]
        return HStack(spacing: 8) {
            Button { if (model.rows ?? []).indices.contains(i) { model.rows![i].on.toggle() } } label: {
                Image(systemName: r.on ? "checkmark.square.fill" : "square").font(.system(size: 22)).foregroundColor(r.on ? NFColor.iris : NFColor.ink3)
            }
            .buttonStyle(.plain)
            NSPInput(text: binding(i, \.categoryName), placeholder: "カテゴリ", width: 140)
            NSPInput(text: binding(i, \.name), placeholder: "商品名", width: 220)
            NSPInput(text: binding(i, \.nameEn), placeholder: "英語名", width: 160)
            NSPInput(text: binding(i, \.price), placeholder: "価格", width: 110, keyboard: .numberPad, trailing: "円")
            Picker("", selection: Binding(get: { r.itemType }, set: { v in if (model.rows ?? []).indices.contains(i) { model.rows![i].itemType = v } })) {
                Text("フード").tag("food")
                Text("ドリンク").tag("drink")
            }
            .pickerStyle(.segmented).frame(width: 150)
            Button { if (model.rows ?? []).indices.contains(i) { model.rows!.remove(at: i) } } label: {
                Image(systemName: "trash").font(.system(size: 15, weight: .semibold)).foregroundColor(NFColor.danger).frame(width: 34, height: 40)
            }
            .buttonStyle(.plain)
        }
        .opacity(r.on ? 1 : 0.5)
        .padding(.horizontal, 18).padding(.vertical, 6)
        .overlay(alignment: .bottom) { Rectangle().fill(NFColor.line).frame(height: 1) }
    }

    private var textCard: some View {
        NSPCard(title: "読み取った文字", en: "間違いを直して「読み直す」と、商品の表を作り直します") {
            VStack(alignment: .leading, spacing: 10) {
                TextEditor(text: $model.text)
                    .font(.system(size: 14, design: .monospaced))
                    .frame(minHeight: 220)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
                NSPButton(text: "読み直す", icon: "arrow.clockwise", busy: model.busy != nil) { Task { await model.reparse() } }
            }
            .padding(18)
        }
    }

    private func resultCard(_ res: NIMResult) -> some View {
        NSPCard(title: "登録しました") {
            VStack(alignment: .leading, spacing: 6) {
                Text("登録 \(res.inserted)件　スキップ \(res.skipped)件\(res.updated.map { "　更新 \($0)件" } ?? "")")
                    .font(.system(size: 16, weight: NT.strong)).foregroundColor(NFColor.success)
                ForEach(res.failed) { f in
                    Text("\(f.rowNumber)行目：\(f.reason)").font(.system(size: 13)).foregroundColor(NFColor.danger)
                }
                NSPButton(text: "メニューを見る", icon: "list.bullet") { state.openSettingsPage(.menu, webPath: NativeSettingsPageKey.menu.path) }
            }
            .padding(18)
        }
    }
}
