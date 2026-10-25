"""Exercise the production foreground-maintenance loop without iOS or a printer."""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[1]
s = (root / 'Shared/NativePrintAgent.swift').read_text()
method = s.split('    private func startConnectionMaintenance() {', 1)[1].split('\n    /// 注文・会計', 1)[0]
# Shorten the timer only; execute the production selection/lifecycle logic.
method = method.replace('5_000_000_000', '5_000_000')
harness = r'''
import Foundation
@MainActor final class UIApplication {
 enum State { case active, background }
 static let shared = UIApplication()
 var applicationState = State.active
}
struct Link { let deviceId: String; let maker: String; let via: String }
struct Config { var appLinks: [Link] = [] }
@MainActor final class NativePrintConfig {
 static let shared = NativePrintConfig()
 var config = Config()
}
@MainActor final class BluetoothPrinters {
 static let shared = BluetoothPrinters()
 var calls: [String] = []
 func prepare(deviceId: String, maker: String, via: String, completion: (Bool, String?) -> Void) {
  calls.append(deviceId); completion(false, "connect")
 }
}
@MainActor final class Agent {
 var running = true
 var connectionMaintenance: Task<Void, Never>?
 func startConnectionMaintenance() {
'''+method+r'''
 func stop() { running = false; connectionMaintenance?.cancel(); connectionMaintenance = nil }
}
@main struct Check {
 @MainActor static func main() async throws {
  let link = Link(deviceId: "selected", maker: "star", via: "bluetooth")
  NativePrintConfig.shared.config.appLinks = [link]
  let agent = Agent(); agent.startConnectionMaintenance()
  try await Task.sleep(nanoseconds: 35_000_000)
  precondition(BluetoothPrinters.shared.calls.count >= 2, "failed connection retries")
  UIApplication.shared.applicationState = .background
  let backgroundCount = BluetoothPrinters.shared.calls.count
  try await Task.sleep(nanoseconds: 25_000_000)
  precondition(BluetoothPrinters.shared.calls.count == backgroundCount, "no background probes")
  UIApplication.shared.applicationState = .active
  NativePrintConfig.shared.config.appLinks = [link, Link(deviceId: "other", maker: "star", via: "bluetooth")]
  try await Task.sleep(nanoseconds: 25_000_000)
  precondition(BluetoothPrinters.shared.calls.count == backgroundCount, "no multi-printer reconnect churn")
  NativePrintConfig.shared.config.appLinks = [Link(deviceId: "ea:paired", maker: "star", via: "bluetooth")]
  try await Task.sleep(nanoseconds: 25_000_000)
  precondition(BluetoothPrinters.shared.calls.count == backgroundCount, "do not pass MFi identifiers to SDK")
  NativePrintConfig.shared.config.appLinks = [link]
  try await Task.sleep(nanoseconds: 25_000_000)
  precondition(BluetoothPrinters.shared.calls.count > backgroundCount, "resume on foreground/current selection")
  agent.stop()
  let stoppedCount = BluetoothPrinters.shared.calls.count
  try await Task.sleep(nanoseconds: 25_000_000)
  precondition(BluetoothPrinters.shared.calls.count == stoppedCount, "stop cancels maintenance")
  print("PASS: retry, foreground-only, multiple-target guard, MFi guard, resume, stop")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='tenpo-maintenance-') as tmp:
 p=Path(tmp); (p/'Check.swift').write_text(harness)
 subprocess.run(['swiftc','-swift-version','5','-parse-as-library',str(p/'Check.swift'),'-o',str(p/'check')],check=True)
 subprocess.run([str(p/'check')],check=True)
