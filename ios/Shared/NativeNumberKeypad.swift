import UIKit

/// iPad：金額・数量など数字だけの入力欄では、iPad の大きなキーボード（あいうえお・英字）の代わりに、
/// アプリの 10-key（会計のテンキーと同じ形）を下から出す（2026-10-25 20:21 Ronnie「金額 मा app कै 10-key」）。
/// 対象は keyboardType が 数字（.numberPad / .asciiCapableNumberPad / .decimalPad / .phonePad）の欄だけ。
/// 宛名・メモなど字を入れる欄は今まで通り iPad のキーボード。iPhone は今まで通り（iPhone のテンキーが出る）。
/// SwiftUI の TextField もこの UITextField なので、画面ごとの直しは要らない（アプリの起動時に 1 回 install）。
enum NativeNumberKeypadInstaller {
    private static var installed = false

    static func install() {
        guard AppConfig.isPad, !installed else { return }
        installed = true
        NotificationCenter.default.addObserver(forName: UITextField.textDidBeginEditingNotification, object: nil, queue: .main) { note in
            guard let field = note.object as? UITextField, field.inputView == nil else { return }
            switch field.keyboardType {
            case .numberPad, .asciiCapableNumberPad, .decimalPad, .phonePad:
                break
            default:
                return
            }
            // 上の予測・ショートカットの帯も出さない（10-key だけ）
            field.inputAssistantItem.leadingBarButtonGroups = []
            field.inputAssistantItem.trailingBarButtonGroups = []
            field.inputView = NativeNumberKeypad(field: field, decimal: field.keyboardType == .decimalPad)
            field.reloadInputViews()
        }
    }
}

/// 10-key の本体（7 8 9 / 4 5 6 / 1 2 3 / 00(.) 0 ⌫ と、右に「C」「完了」）
final class NativeNumberKeypad: UIInputView {
    private weak var field: UITextField?
    private let decimal: Bool

    private static let keyBg = UIColor(red: 0xFB / 255, green: 0xF9 / 255, blue: 0xF5 / 255, alpha: 1)
    private static let line = UIColor(red: 0xDC / 255, green: 0xE3 / 255, blue: 0xEF / 255, alpha: 1)
    private static let ink = UIColor(red: 0x29 / 255, green: 0x27 / 255, blue: 0x25 / 255, alpha: 1)
    private static let blue = UIColor(red: 0x2A / 255, green: 0x6F / 255, blue: 0xE6 / 255, alpha: 1)
    private static let lilac = UIColor(red: 0xE7 / 255, green: 0xEF / 255, blue: 0xFD / 255, alpha: 1)
    private static let danger = UIColor(red: 0xC6 / 255, green: 0x28 / 255, blue: 0x28 / 255, alpha: 1)

    init(field: UITextField, decimal: Bool) {
        self.field = field
        self.decimal = decimal
        super.init(frame: CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: 300), inputViewStyle: .keyboard)
        allowsSelfSizing = false
        autoresizingMask = [.flexibleWidth]
        build()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: 300) }

    private func build() {
        let rows: [[String]] = [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], [decimal ? "." : "00", "0", "⌫"]]
        let grid = UIStackView()
        grid.axis = .vertical
        grid.spacing = 8
        grid.distribution = .fillEqually
        for row in rows {
            let h = UIStackView()
            h.axis = .horizontal
            h.spacing = 8
            h.distribution = .fillEqually
            for k in row { h.addArrangedSubview(key(k)) }
            grid.addArrangedSubview(h)
        }

        let side = UIStackView()
        side.axis = .vertical
        side.spacing = 8
        side.distribution = .fill
        let clear = key("C")
        let done = key("完了")
        side.addArrangedSubview(clear)
        side.addArrangedSubview(done)
        clear.heightAnchor.constraint(equalTo: done.heightAnchor, multiplier: 1.0 / 3.0, constant: -6).isActive = true

        let all = UIStackView(arrangedSubviews: [grid, side])
        all.axis = .horizontal
        all.spacing = 8
        all.translatesAutoresizingMaskIntoConstraints = false
        addSubview(all)
        side.widthAnchor.constraint(equalTo: grid.widthAnchor, multiplier: 1.0 / 3.0, constant: -6).isActive = true

        // 横に広がりすぎない（真ん中に、最大 560pt）
        let wide = all.widthAnchor.constraint(equalTo: widthAnchor, constant: -24)
        wide.priority = .defaultHigh
        NSLayoutConstraint.activate([
            all.centerXAnchor.constraint(equalTo: centerXAnchor),
            all.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
            wide,
            all.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            all.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -12),
        ])
    }

    private func key(_ k: String) -> UIButton {
        var c = UIButton.Configuration.filled()
        c.cornerStyle = .large
        switch k {
        case "完了":
            c.baseBackgroundColor = Self.blue
            c.baseForegroundColor = .white
        case "C":
            c.baseBackgroundColor = Self.lilac
            c.baseForegroundColor = Self.danger
        default:
            c.baseBackgroundColor = Self.keyBg
            c.baseForegroundColor = Self.ink
        }
        if k == "⌫" {
            c.image = UIImage(systemName: "delete.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .bold))
        } else {
            var t = AttributedString(k)
            t.font = .systemFont(ofSize: k == "完了" ? 20 : 26, weight: .bold)
            c.attributedTitle = t
        }
        let b = UIButton(configuration: c)
        b.layer.cornerRadius = 12
        b.layer.borderWidth = k == "完了" ? 0 : 1
        b.layer.borderColor = Self.line.cgColor
        b.accessibilityLabel = k == "⌫" ? "1文字消す" : k
        b.addAction(UIAction { [weak self] _ in self?.tap(k) }, for: .touchUpInside)
        return b
    }

    private func tap(_ k: String) {
        guard let f = field else { return }
        UIDevice.current.playInputClick()
        switch k {
        case "⌫":
            f.deleteBackward()
        case "C":
            // 1 文字ずつ消す（SwiftUI の TextField にも変更が届くように、キーボードと同じ消し方で）
            var guardCount = 0
            while f.hasText && guardCount < 64 { f.deleteBackward(); guardCount += 1 }
        case "完了":
            f.resignFirstResponder()
        case ".":
            if !(f.text ?? "").contains(".") { f.insertText(".") }
        default:
            f.insertText(k)
        }
    }
}

extension NativeNumberKeypad: UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
}
