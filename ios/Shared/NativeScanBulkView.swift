import SwiftUI
import PhotosUI

// ScanSnap のまとめて取り込み（iPad・ネイティブ）。Web の /app/scan#scan-bulk（components/scan/scan-bulk-import.tsx）と同じ並び・同じ結果。
// 2026-10-25 Ronnie「iPad のサブメニューのサブメニューまで全部ネイティブ」。中身（読み取り・アップロード・登録）は NativeScanBulkKit.swift（iPhone と同じ）。
// 開く道：AppState の #scan-bulk の分かれ道（/app/scan#scan-bulk）→ NativeModuleScreen の "scanBulk"。スキャンの画面のボタンは state.openNativeScanBulk()。

struct NativeScanBulkView: View {
    let onBack: () -> Void

    @StateObject private var model: NativeScanBulkModel
    @State private var showFiles = false
    @State private var picks: [PhotosPickerItem] = []
    @State private var preview: NSBPreview?
    @FocusState private var focus: String?
    @State private var lastFocus: String?

    /// model は見本（NativePreview）のときだけ渡す
    init(model: NativeScanBulkModel? = nil, onBack: @escaping () -> Void) {
        self.onBack = onBack
        _model = StateObject(wrappedValue: model ?? NativeScanBulkModel())
    }

    var body: some View {
        VStack(spacing: 0) {
            NativeTopBar(storeName: "", title: "ScanSnap まとめて取り込み", subtitle: "Import scans", onHome: onBack, backIcon: "chevron.left")
            if let info = model.info {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        headerCard(info)
                        if !model.rows.isEmpty { rowsSection(info) }
                    }
                    .padding(16)
                    .frame(maxWidth: 1100)
                    .frame(maxWidth: .infinity)
                }
                .scrollDismissesKeyboard(.interactively)
            } else {
                Spacer()
                if let e = model.loadError {
                    VStack(spacing: 10) {
                        Text(e).font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.danger).multilineTextAlignment(.center)
                        Button("もう一度") { Task { await model.load() } }
                    }
                    .padding(30)
                } else {
                    ProgressView("読み込み中…").tint(NFColor.iris)
                }
                Spacer()
            }
        }
        .background(NFColor.lilac.ignoresSafeArea())
        .task { await model.load() }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: NSBFile.types, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result, !urls.isEmpty else { return }
            Task { await model.run(files: urls) }
        }
        .onChange(of: picks) { items in
            guard !items.isEmpty else { return }
            let chosen = items
            picks = []
            Task { await model.run(photos: chosen) }
        }
        // 欄を離れたら、直した内容で案を出し直す（Web の onBlur と同じ）
        .onChange(of: focus) { now in
            if let prev = lastFocus, prev != now, let id = Self.rowId(prev) { model.blur(id) }
            lastFocus = now
        }
        .fullScreenCover(item: $preview) { p in
            NSBPreviewView(item: p, onClose: { preview = nil })
        }
    }

    private static func rowId(_ key: String) -> UUID? {
        UUID(uuidString: String(key.split(separator: "|").first ?? ""))
    }

    private func key(_ r: NSBRow, _ field: String) -> String { r.id.uuidString + "|" + field }

    // MARK: 上のカード

    private func headerCard(_ info: NSBInfo) -> some View {
        let disabled = model.busy
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "folder")
                    .font(.system(size: 20, weight: .semibold)).foregroundColor(NFColor.iris)
                    .frame(width: 40, height: 40)
                    .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.irisSoft))
                VStack(alignment: .leading, spacing: 2) {
                    Text("ScanSnap の書類をまとめて取り込む").font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.ink)
                    Text("Import scanned receipts & bills").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                }
                Spacer()
                PhotosPicker(selection: $picks, maxSelectionCount: info.maxFiles, matching: .images) {
                    HStack(spacing: 7) {
                        Image(systemName: "photo.on.rectangle")
                        Text("写真から選ぶ")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(NFColor.royal)
                    .padding(.horizontal, 16).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
                }
                .disabled(disabled)
                .opacity(disabled ? 0.6 : 1)
                Button { showFiles = true } label: {
                    HStack(spacing: 7) {
                        if model.running { ProgressView().tint(.white).scaleEffect(0.8) } else { Image(systemName: "doc.text") }
                        Text("ファイルから選ぶ")
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundColor(.white)
                    .padding(.horizontal, 18).frame(height: 44)
                    .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.iris))
                }
                .buttonStyle(PressableStyle())
                .disabled(disabled)
                .opacity(disabled ? 0.6 : 1)
            }
            if model.rows.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(NSBText.steps.enumerated()), id: \.offset) { i, t in
                        Text("\(i + 1). \(t)").font(.system(size: 12.5)).foregroundColor(NFColor.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let p = model.progress {
                VStack(alignment: .leading, spacing: 6) {
                    Text(p.text).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1)
                    ProgressView(value: p.value, total: p.total).tint(NFColor.iris)
                }
            }
            Text("取り込み先：\(info.storeName ?? "本部（全店舗）") の今日のフォルダ ・ 1回に \(info.maxFiles) 件まで ・ 文字の読み取りはこの iPad の中で行います（料金なし・外に送りません）")
                .font(.system(size: 11.5)).foregroundColor(NFColor.ink3).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(NFColor.line, lineWidth: 1))
    }

    // MARK: 一覧

    private func rowsSection(_ info: NSBInfo) -> some View {
        let confirmCount = model.confirmRows.count
        let readyCount = model.ready.count
        return VStack(alignment: .leading, spacing: 10) {
            if confirmCount > 0 {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("内容を確かめて「登録」してください（\(confirmCount)件）").font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink)
                        Text("直したところがあれば、そのまま「登録」で直した内容で入ります").font(.system(size: 11)).foregroundColor(NFColor.ink3)
                    }
                    Spacer()
                    Button {
                        focus = nil
                        Task { await model.registerAll() }
                    } label: {
                        HStack(spacing: 7) {
                            if model.savingAll { ProgressView().tint(.white).scaleEffect(0.8) }
                            Text("まとめて登録（\(readyCount)件）")
                        }
                        .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                        .padding(.horizontal, 16).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 11).fill(NFColor.iris))
                    }
                    .buttonStyle(PressableStyle())
                    .disabled(readyCount == 0 || model.savingAll)
                    .opacity(readyCount == 0 || model.savingAll ? 0.5 : 1)
                }
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 12).fill(NFColor.irisSoft))
            }
            if model.finished { summary }
            ForEach(model.rows) { r in
                if r.state == .confirm || r.state == .saving {
                    confirmCard(r, info)
                } else {
                    statusRow(r)
                }
            }
        }
    }

    private var summary: some View {
        HStack(spacing: 10) {
            Text(model.summaryText).font(.system(size: 13.5, weight: .bold)).foregroundColor(NFColor.ink).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if let day = model.folderDay {
                Button("\(NSBText.md(day)) のフォルダを見る ›") { onBack() }
                    .font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.royal)
            }
        }
        .padding(.horizontal, 4)
    }

    private func statusRow(_ r: NSBRow) -> some View {
        HStack(spacing: 10) {
            Group {
                if r.state == .working {
                    ProgressView().tint(NFColor.ink3)
                } else if r.state == .waiting {
                    Image(systemName: "hourglass").foregroundColor(NFColor.ink3)
                } else if r.state == .done && r.outcome?.result != "review" {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(NFColor.success)
                } else {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NFColor.saffron)
                }
            }
            .frame(width: 20)
            Text(r.name).font(.system(size: 12.5)).foregroundColor(NFColor.ink2).lineLimit(1).truncationMode(.middle)
            Spacer(minLength: 8)
            Text(NSBText.status(r)).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.ink).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(NFColor.line, lineWidth: 1))
    }

    // MARK: 1件の確かめ・直し・登録先の選択

    private func confirmCard(_ r: NSBRow, _ info: NSBInfo) -> some View {
        let reading = r.reading ?? NSBReading()
        let busy = r.state == .saving || r.planning
        let canRegister = !busy && r.action != nil && (r.action != "attach" || r.txId != nil)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                thumbButton(r)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Text(r.name).font(.system(size: 13, weight: .bold)).foregroundColor(NFColor.ink).lineLimit(1).truncationMode(.middle)
                        Spacer(minLength: 8)
                        kindToggle(r, reading, busy: busy)
                    }
                    fields(r, reading, info, busy: busy)
                }
            }
            warnings(r)
            choicesBox(r, busy: busy)
            if let m = r.message {
                Text(m).font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.danger).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Spacer()
                Button {
                    focus = nil
                    Task { await model.register(r.id, action: "keep") }
                } label: {
                    Text("あとで").font(.system(size: 14, weight: .bold)).foregroundColor(NFColor.ink)
                        .padding(.horizontal, 18).frame(height: 42)
                        .background(RoundedRectangle(cornerRadius: 11).fill(Color.white))
                        .overlay(RoundedRectangle(cornerRadius: 11).stroke(NFColor.line, lineWidth: 1))
                }
                .buttonStyle(PressableStyle())
                .disabled(busy)
                .opacity(busy ? 0.5 : 1)
                Button {
                    focus = nil
                    Task { await model.register(r.id) }
                } label: {
                    HStack(spacing: 7) {
                        if r.state == .saving { ProgressView().tint(.white).scaleEffect(0.8) }
                        Text("登録")
                    }
                    .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                    .frame(minWidth: 120).padding(.horizontal, 18).frame(height: 42)
                    .background(RoundedRectangle(cornerRadius: 11).fill(NFColor.iris))
                }
                .buttonStyle(PressableStyle())
                .disabled(!canRegister)
                .opacity(canRegister ? 1 : 0.5)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(NFColor.iris.opacity(0.4), lineWidth: 1.5))
    }

    private func thumbButton(_ r: NSBRow) -> some View {
        Button {
            if let u = r.fileURL { preview = NSBPreview(url: u, pdf: r.isPdf, name: r.name) }
        } label: {
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 8).fill(NFColor.lilacSoft)
                if let t = r.thumb {
                    Image(uiImage: t).resizable().scaledToFill().frame(width: 66, height: 88, alignment: .top).clipped()
                } else {
                    Image(systemName: "doc.text").font(.system(size: 22)).foregroundColor(NFColor.ink3).frame(width: 66, height: 88)
                }
            }
            .frame(width: 66, height: 88)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(NFColor.line, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("スキャンした書類を大きく見る")
    }

    private func kindToggle(_ r: NSBRow, _ reading: NSBReading, busy: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(["receipt", "bill"], id: \.self) { k in
                let on = reading.kind == k
                Button {
                    guard reading.kind != k else { return }
                    model.edit(r.id, now: true) { rd in
                        let cat = rd.category
                        rd.kind = k
                        rd.category = k == "bill" ? (cat ?? "vendor") : nil
                        rd.payment = nil
                    }
                } label: {
                    Text(k == "receipt" ? "レシート" : "請求書")
                        .font(.system(size: 12.5, weight: .bold)).foregroundColor(on ? .white : NFColor.ink2)
                        .padding(.horizontal, 14).frame(height: 32)
                        .background(RoundedRectangle(cornerRadius: 8).fill(on ? NFColor.iris : Color.clear))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
        .disabled(busy)
    }

    private func fieldLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
    }

    private func box<C: View>(_ c: C) -> some View {
        c.padding(.horizontal, 10).frame(height: 40)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
    }

    private func fields(_ r: NSBRow, _ reading: NSBReading, _ info: NSBInfo, busy: Bool) -> some View {
        let isReceipt = reading.kind == "receipt"
        let payments = isReceipt ? info.receiptPayments : info.billPayments
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 10, alignment: .topLeading)], alignment: .leading, spacing: 10) {
            // 日付
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel("日付")
                if let d = reading.date {
                    HStack(spacing: 6) {
                        DatePicker("", selection: Binding(get: { NPDate.date(d) }, set: { v in
                            model.edit(r.id, now: false) { $0.date = NPDate.str(v) }
                            model.scheduleReplan(r.id)
                        }), displayedComponents: .date)
                        .labelsHidden()
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                        .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                        Button { model.edit(r.id, now: true) { $0.date = nil } } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 17)).foregroundColor(NFColor.ink3)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("日付を消す")
                    }
                    .frame(height: 40)
                } else {
                    Button { model.edit(r.id, now: true) { $0.date = info.today } } label: {
                        box(HStack { Text("日付なし（入れる）").font(.system(size: 14)).foregroundColor(NFColor.ink3); Spacer(minLength: 0); Image(systemName: "calendar").foregroundColor(NFColor.ink3) })
                    }
                    .buttonStyle(.plain)
                }
            }
            .disabled(busy)
            // 店名・発行元
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel(isReceipt ? "店名" : "発行元")
                box(
                    TextField("", text: Binding(get: { reading.vendorName ?? "" }, set: { v in
                        model.edit(r.id, now: false) { $0.vendorName = v.isEmpty ? nil : v }
                    }))
                    .font(.system(size: 16))
                    .focused($focus, equals: key(r, "vendor"))
                    .onSubmit { model.blur(r.id) }
                )
            }
            .disabled(busy)
            // 金額（税込）
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel("金額（税込）")
                box(
                    TextField("", text: Binding(get: { NSBText.yen(reading.amount) }, set: { v in
                        model.edit(r.id, now: false) { $0.amount = NSBText.num(v) }
                    }))
                    .font(.system(size: 16, weight: .bold)).monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numberPad)
                    .focused($focus, equals: key(r, "amount"))
                )
            }
            .disabled(busy)
            // うち消費税
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel("うち消費税")
                box(
                    TextField("", text: Binding(get: { NSBText.yen(reading.tax) }, set: { v in
                        model.edit(r.id, now: false) { $0.tax = NSBText.num(v) }
                    }))
                    .font(.system(size: 16)).monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .keyboardType(.numberPad)
                    .focused($focus, equals: key(r, "tax"))
                )
            }
            .disabled(busy)
            // 支払い
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel("支払い")
                Menu {
                    Button(isReceipt ? "わからない（現金）" : "わからない") { model.edit(r.id, now: true) { $0.payment = nil } }
                    ForEach(payments, id: \.value) { o in
                        Button(o.label) { model.edit(r.id, now: true) { $0.payment = o.value } }
                    }
                } label: {
                    box(HStack {
                        Text(model.paymentLabel(reading.payment, receipt: isReceipt)).font(.system(size: 14)).foregroundColor(NFColor.ink).lineLimit(1)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                    })
                }
            }
            .disabled(busy)
            // 費目（請求書だけ）
            if !isReceipt {
                VStack(alignment: .leading, spacing: 3) {
                    fieldLabel("費目")
                    Menu {
                        ForEach(info.categories, id: \.value) { o in
                            Button(o.label) { model.edit(r.id, now: true) { $0.category = o.value } }
                        }
                    } label: {
                        box(HStack {
                            Text(model.categoryLabel(reading.category)).font(.system(size: 14)).foregroundColor(NFColor.ink).lineLimit(1)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NFColor.ink3)
                        })
                    }
                }
                .disabled(busy)
            }
        }
    }

    private func warnings(_ r: NSBRow) -> some View {
        let dup = r.plan?.duplicate
        return Group {
            if dup != nil || r.pages >= 3 {
                VStack(alignment: .leading, spacing: 4) {
                    if let dup {
                        Label("\(dup)。二重にならないよう「あとで」にしています", systemImage: "exclamationmark.triangle")
                    }
                    if r.pages >= 3 {
                        Label("\(r.pages)ページあります（読むのは最初の2ページ）。レシートが何枚も入っているときは ScanSnap で1枚ずつのファイルにしてください", systemImage: "exclamationmark.triangle")
                    }
                }
                .font(.system(size: 12.5, weight: .bold)).foregroundColor(NFColor.saffron)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.saffronSoft))
            }
        }
    }

    private func choicesBox(_ r: NSBRow, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if r.planning { ProgressView().scaleEffect(0.7) }
                Text("登録先").font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.ink)
                if r.dirty {
                    Button("直した内容で確かめ直す") { model.blur(r.id) }
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NFColor.royal)
                } else {
                    Text(r.plan?.note ?? "").font(.system(size: 12)).foregroundColor(NFColor.ink2).lineLimit(2)
                }
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], alignment: .leading, spacing: 8) {
                ForEach(r.choices) { c in choiceButton(r, c, busy: busy) }
            }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).fill(NFColor.lilacSoft))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(NFColor.line, lineWidth: 1))
    }

    private func choiceButton(_ r: NSBRow, _ c: NSBChoice, busy: Bool) -> some View {
        let on = r.action == c.action && (c.action != "attach" || r.txId == c.txId)
        return Button {
            focus = nil
            model.choose(r.id, action: c.action, txId: c.txId)
        } label: {
            HStack(spacing: 8) {
                ZStack {
                    Circle().stroke(on ? NFColor.iris : Color(hex: 0xD1D5DB), lineWidth: 2).frame(width: 16, height: 16)
                    if on { Circle().fill(NFColor.iris).frame(width: 8, height: 8) }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.label).font(.system(size: 13, weight: on ? .bold : .regular)).foregroundColor(on ? NFColor.ink : NFColor.ink2).lineLimit(1)
                    if let s = c.sub { Text(s).font(.system(size: 11)).foregroundColor(NFColor.ink3).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(on ? 1 : 0.7)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(on ? NFColor.iris : NFColor.line, lineWidth: on ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}
