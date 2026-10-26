import SwiftUI
import PhotosUI

// iPhone の店長・オーナー：ScanSnap のまとめて取り込み（Web の /app/scan#scan-bulk。2026-10-25 Ronnie「101% native」）。
// 中身（読み取り・アップロード・登録先の案・登録）は iPad と同じ NativeScanBulkModel（NativeScanBulkKit.swift）。ここは iPhone の幅の並びだけ。
//   ファイルから選ぶ（ScanSnap Home →「ファイルに保存」）・写真から選ぶ（「写真に保存」）→ 1件ずつ読み取り → 確かめ・直して「登録」／「まとめて登録」
// 開く道：NativePhoneOwnerRegistry（/app/scan#scan-bulk → key "scanBulk"）。戻る＝iPhone のスキャンの画面（/app/scan）。

struct NativePhoneOwnerScanBulkView: View {
    @ObservedObject var model: NativeScanBulkModel
    let onBack: () -> Void
    /// 終わったあとの「今日のフォルダを見る」（スキャンの画面のレシートボックス）
    let onFolder: () -> Void

    @State private var showFiles = false
    @State private var picks: [PhotosPickerItem] = []
    @State private var preview: NSBPreview?
    @FocusState private var focus: String?
    @State private var lastFocus: String?

    var body: some View {
        VStack(spacing: 0) {
            NPHTopBar(title: "まとめて取り込み", subtitle: "ScanSnap・レシート・請求書", backLabel: "スキャン", onBack: onBack, trailing: {
                Color.clear.frame(width: 44, height: 44)
            })
            if let info = model.info {
                content(info)
            } else {
                NOSStateView(error: model.loadError) { Task { await model.load() } }
            }
        }
        .background(NT.page.ignoresSafeArea())
        .environment(\.colorScheme, .light)
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

    private func content(_ info: NSBInfo) -> some View {
        ScrollView {
            VStack(spacing: 12) {
                pickCard(info)
                if let p = model.progress { progressCard(p.text, value: p.value, total: p.total) }
                if model.finished { summaryCard }
                ForEach(model.rows) { r in
                    if r.state == .confirm || r.state == .saving {
                        confirmCard(r, info)
                    } else {
                        statusRow(r)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.top, 10).padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom) {
            if !model.confirmRows.isEmpty { registerAllBar }
        }
    }

    // MARK: 選ぶ

    private func pickCard(_ info: NSBInfo) -> some View {
        NPOCard(title: "ScanSnap の書類をまとめて取り込む", trailing: "\(info.maxFiles)件まで") {
            HStack(spacing: 8) {
                Button { showFiles = true } label: {
                    VStack(spacing: 3) {
                        if model.running { ProgressView().tint(.white) } else { Image(systemName: "doc.text").font(.system(size: 20, weight: .bold)) }
                        Text("ファイルから選ぶ").font(.system(size: 14.5, weight: NT.strong))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 70)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.purple))
                }
                .buttonStyle(PressableStyle())
                PhotosPicker(selection: $picks, maxSelectionCount: info.maxFiles, matching: .images) {
                    VStack(spacing: 3) {
                        Image(systemName: "photo.on.rectangle").font(.system(size: 20, weight: .bold))
                        Text("写真から選ぶ").font(.system(size: 14.5, weight: NT.strong))
                    }
                    .foregroundColor(NT.purpleDeep)
                    .frame(maxWidth: .infinity).frame(height: 70)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(NT.lilac))
                }
            }
            .disabled(model.busy)
            .opacity(model.busy ? 0.55 : 1)
            if model.rows.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(NSBText.steps.enumerated()), id: \.offset) { i, t in
                        Text("\(i + 1). \(t)").font(.system(size: 12.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Text("取り込み先：\(info.storeName ?? "本部（全店舗）") の今日のフォルダ。文字の読み取りはこの iPhone の中で行います（料金なし・外に送りません）")
                .font(.system(size: 11)).foregroundColor(NT.ink3).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func progressCard(_ text: String, value: Double, total: Double) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(text).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink).lineLimit(2)
            ProgressView(value: value, total: total).tint(NT.purple)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("取り込みが終わりました", systemImage: "checkmark.circle.fill").font(.system(size: 14, weight: NT.strong)).foregroundColor(NT.ok)
            Text(model.summaryText).font(.system(size: 13, weight: .bold)).foregroundColor(NT.ink).fixedSize(horizontal: false, vertical: true)
            if let day = model.folderDay {
                NOMButton(title: "\(NSBText.md(day)) のフォルダを見る", icon: "folder", filled: false, height: 44, action: onFolder)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white))
    }

    /// 下に出す「まとめて登録」（確かめ待ちがあるとき）
    private var registerAllBar: some View {
        let readyCount = model.ready.count
        let enabled = readyCount > 0 && !model.savingAll
        return VStack(spacing: 4) {
            Text("確かめ待ち \(model.confirmRows.count)件 ・ 直したところは直した内容で入ります").font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1)
            Button {
                focus = nil
                Task { await model.registerAll() }
            } label: {
                HStack(spacing: 7) {
                    if model.savingAll { ProgressView().tint(.white) } else { Image(systemName: "tray.and.arrow.down.fill").font(.system(size: 15, weight: .bold)) }
                    Text("まとめて登録（\(readyCount)件）").font(.system(size: 16, weight: NT.strong))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity).frame(height: 50)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
                .opacity(enabled ? 1 : 0.45)
            }
            .buttonStyle(PressableStyle())
            .disabled(!enabled)
        }
        .padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 8)
        .background(Color.white.shadow(color: Color.black.opacity(0.08), radius: 6, y: -2).ignoresSafeArea(edges: .bottom))
    }

    // MARK: 一覧の 1 行（確かめ待ち以外）

    private func statusRow(_ r: NSBRow) -> some View {
        HStack(spacing: 10) {
            Group {
                if r.state == .working {
                    ProgressView().tint(NT.purple)
                } else if r.state == .waiting {
                    Image(systemName: "hourglass").foregroundColor(NT.ink3)
                } else if r.state == .done && r.outcome?.result != "review" {
                    Image(systemName: "checkmark.circle.fill").foregroundColor(NT.ok)
                } else {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundColor(NT.warn)
                }
            }
            .font(.system(size: 16))
            .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(NSBText.status(r)).font(.system(size: 13, weight: .bold)).foregroundColor(r.state == .failed ? NT.danger : NT.ink).fixedSize(horizontal: false, vertical: true)
                Text(r.name).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1).truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.white))
    }

    // MARK: 1件の確かめ・直し・登録先の選択（iPhone の幅：上から順に）

    private func confirmCard(_ r: NSBRow, _ info: NSBInfo) -> some View {
        let reading = r.reading ?? NSBReading()
        let busy = r.state == .saving || r.planning
        let canRegister = !busy && r.action != nil && (r.action != "attach" || r.txId != nil)
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                thumbButton(r)
                VStack(alignment: .leading, spacing: 8) {
                    Text(r.name).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.ink).lineLimit(2).truncationMode(.middle)
                    kindToggle(r, reading, busy: busy)
                    if let a = reading.amount {
                        Text(NT.yen(a)).font(.system(size: 20, weight: NT.strong)).foregroundColor(NT.ink).monospacedDigit()
                    }
                }
                Spacer(minLength: 0)
            }
            fields(r, reading, info, busy: busy)
            warnings(r)
            choicesBox(r, busy: busy)
            if let m = r.message {
                Text(m).font(.system(size: 12.5, weight: .bold)).foregroundColor(NT.danger).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                NOMButton(title: "あとで", filled: false, height: 46, enabled: !busy) {
                    focus = nil
                    Task { await model.register(r.id, action: "keep") }
                }
                .frame(maxWidth: 120)
                Button {
                    focus = nil
                    Task { await model.register(r.id) }
                } label: {
                    HStack(spacing: 7) {
                        if r.state == .saving { ProgressView().tint(.white) }
                        Text("登録").font(.system(size: 15.5, weight: NT.strong))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity).frame(height: 46)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NT.purple))
                    .opacity(canRegister ? 1 : 0.45)
                }
                .buttonStyle(PressableStyle())
                .disabled(!canRegister)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(NT.purple.opacity(0.35), lineWidth: 1.5))
    }

    private func thumbButton(_ r: NSBRow) -> some View {
        Button {
            if let u = r.fileURL { preview = NSBPreview(url: u, pdf: r.isPdf, name: r.name) }
        } label: {
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(NT.page)
                if let t = r.thumb {
                    Image(uiImage: t).resizable().scaledToFill().frame(width: 72, height: 96, alignment: .top).clipped()
                } else {
                    Image(systemName: "doc.text").font(.system(size: 22)).foregroundColor(NT.ink3).frame(width: 72, height: 96)
                }
            }
            .frame(width: 72, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(NT.line, lineWidth: 1))
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
                        .font(.system(size: 13, weight: NT.strong)).foregroundColor(on ? .white : NT.ink2)
                        .frame(maxWidth: .infinity).frame(height: 34)
                        .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(on ? NT.purple : Color.clear))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NT.page))
        .disabled(busy)
    }

    private func fieldLabel(_ t: String) -> some View {
        Text(t).font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
    }

    private func box<C: View>(_ c: C) -> some View {
        c.padding(.horizontal, 10).frame(height: 44)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(NT.line, lineWidth: 1))
    }

    private func menuBox(_ text: String) -> some View {
        box(HStack {
            Text(text).font(.system(size: 14.5)).foregroundColor(NT.ink).lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .bold)).foregroundColor(NT.ink3)
        })
    }

    private func fields(_ r: NSBRow, _ reading: NSBReading, _ info: NSBInfo, busy: Bool) -> some View {
        let isReceipt = reading.kind == "receipt"
        let payments = isReceipt ? info.receiptPayments : info.billPayments
        return VStack(alignment: .leading, spacing: 9) {
            // 日付
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel("日付")
                if let d = reading.date {
                    HStack(spacing: 8) {
                        DatePicker("", selection: Binding(get: { NPDate.date(d) }, set: { v in
                            model.edit(r.id, now: false) { $0.date = NPDate.str(v) }
                            model.scheduleReplan(r.id)
                        }), displayedComponents: .date)
                        .labelsHidden()
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                        .environment(\.timeZone, TimeZone(identifier: "Asia/Tokyo")!)
                        Spacer(minLength: 0)
                        Button { model.edit(r.id, now: true) { $0.date = nil } } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundColor(NT.ink3).frame(width: 44, height: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("日付を消す")
                    }
                } else {
                    Button { model.edit(r.id, now: true) { $0.date = info.today } } label: {
                        box(HStack { Text("日付なし（入れる）").font(.system(size: 14.5)).foregroundColor(NT.ink3); Spacer(minLength: 0); Image(systemName: "calendar").foregroundColor(NT.ink3) })
                    }
                    .buttonStyle(.plain)
                }
            }
            // 店名・発行元
            VStack(alignment: .leading, spacing: 3) {
                fieldLabel(isReceipt ? "店名" : "発行元")
                box(
                    TextField("", text: Binding(get: { reading.vendorName ?? "" }, set: { v in
                        model.edit(r.id, now: false) { $0.vendorName = v.isEmpty ? nil : v }
                    }))
                    .font(.system(size: 16))
                    .submitLabel(.done)
                    .focused($focus, equals: key(r, "vendor"))
                    .onSubmit { model.blur(r.id) }
                )
            }
            HStack(alignment: .top, spacing: 8) {
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
            }
            HStack(alignment: .top, spacing: 8) {
                // 支払い
                VStack(alignment: .leading, spacing: 3) {
                    fieldLabel("支払い")
                    Menu {
                        Button(isReceipt ? "わからない（現金）" : "わからない") { model.edit(r.id, now: true) { $0.payment = nil } }
                        ForEach(payments, id: \.value) { o in
                            Button(o.label) { model.edit(r.id, now: true) { $0.payment = o.value } }
                        }
                    } label: {
                        menuBox(model.paymentLabel(reading.payment, receipt: isReceipt))
                    }
                }
                // 費目（請求書だけ）
                if !isReceipt {
                    VStack(alignment: .leading, spacing: 3) {
                        fieldLabel("費目")
                        Menu {
                            ForEach(info.categories, id: \.value) { o in
                                Button(o.label) { model.edit(r.id, now: true) { $0.category = o.value } }
                            }
                        } label: {
                            menuBox(model.categoryLabel(reading.category))
                        }
                    }
                }
            }
            if focus != nil && (focus ?? "").hasPrefix(r.id.uuidString) {
                Button("入力を終える") { focus = nil }
                    .font(.system(size: 13, weight: .bold)).foregroundColor(NT.purpleDeep)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
        .disabled(busy)
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
                .font(.system(size: 12, weight: .bold)).foregroundColor(NT.warn)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(NT.warn.opacity(0.1)))
            }
        }
    }

    private func choicesBox(_ r: NSBRow, busy: Bool) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                if r.planning { ProgressView().scaleEffect(0.7) }
                Text("登録先").font(.system(size: 12.5, weight: NT.strong)).foregroundColor(NT.ink)
                Spacer(minLength: 0)
                if r.dirty {
                    Button("直した内容で確かめ直す") { model.blur(r.id) }
                        .font(.system(size: 12, weight: .bold)).foregroundColor(NT.purpleDeep)
                }
            }
            if !r.dirty, let note = r.plan?.note, !note.isEmpty {
                Text(note).font(.system(size: 11.5)).foregroundColor(NT.ink2).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(r.choices) { c in choiceButton(r, c, busy: busy) }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NT.page))
    }

    private func choiceButton(_ r: NSBRow, _ c: NSBChoice, busy: Bool) -> some View {
        let on = r.action == c.action && (c.action != "attach" || r.txId == c.txId)
        return Button {
            focus = nil
            model.choose(r.id, action: c.action, txId: c.txId)
        } label: {
            HStack(spacing: 9) {
                ZStack {
                    Circle().stroke(on ? NT.purple : Color(hex: 0xD1D5DB), lineWidth: 2).frame(width: 18, height: 18)
                    if on { Circle().fill(NT.purple).frame(width: 9, height: 9) }
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.label).font(.system(size: 13.5, weight: on ? .bold : .regular)).foregroundColor(on ? NT.ink : NT.ink2)
                        .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                    if let s = c.sub { Text(s).font(.system(size: 11)).foregroundColor(NT.ink3).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12).padding(.vertical, 8).frame(minHeight: 46)
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(Color.white))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(on ? NT.purple : NT.line, lineWidth: on ? 2 : 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }
}

// MARK: - key "scanBulk" の画面（NativePhoneOwnerScreen から）

struct NativePhoneOwnerScanBulkScreen: View {
    let route: NativeModuleRoute
    @EnvironmentObject var state: AppState
    @StateObject private var model = NativeScanBulkModel()

    var body: some View {
        NativePhoneOwnerScanBulkView(
            model: model,
            onBack: { state.leaveNativePhone(to: "/app/scan") },
            onFolder: { state.leaveNativePhone(to: "/app/scan") }
        )
        .modifier(NPOCWebFallback(key: "scanBulk", useWeb: model.useWeb, state: state))
    }
}
