import AudioToolbox
import UIKit

/// 振動（iPhone）。iPad には振動のモーターが無いので、何もしない
enum Haptics {
    /// pattern は [鳴らす, 休む, 鳴らす, …]（ミリ秒）。鳴らすところで1回ずつ震わせる
    static func play(pattern: [Int]) {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return }
        var delay = 0.0
        for (index, ms) in pattern.enumerated() {
            if index % 2 == 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
                    UINotificationFeedbackGenerator().notificationOccurred(.warning)
                }
            }
            delay += max(Double(ms), 400) / 1000.0
        }
    }
}
