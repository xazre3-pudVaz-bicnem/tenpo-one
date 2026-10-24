import Foundation

/// 画面を開いた瞬間に前の中身を出すための、アプリの中だけの保存（2026-10-24 Ronnie「オーダー会計 jastai button click garepaxi
/// 0.5 sec 読込み、kina ho?」）。開くたびにサーバーから読み直していたので一瞬「読み込み中」が出ていた。
/// これからは前に読んだ中身をすぐ出して、裏で読み直して入れ替える（Airレジと同じ）。ホームを開いたときに
/// オーダー・会計（フロア）と店舗台帳を先に読んでおくので、最初に押したときも待たない。
@MainActor
final class NativeScreenCache {
    static let shared = NativeScreenCache()

    private var values: [String: (value: Any, at: Date)] = [:]

    func get<T>(_ key: String) -> T? { values[key]?.value as? T }

    /// 読んでから何秒たったか（無ければ nil）
    func age(_ key: String) -> TimeInterval? { values[key].map { Date().timeIntervalSince($0.at) } }

    func set<T>(_ key: String, _ value: T) { values[key] = (value, Date()) }

    func clear() { values.removeAll() }
}
