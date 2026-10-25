"""Run the production Star session actor against a counting transport (no hardware)."""
from pathlib import Path
import subprocess, tempfile
root = Path(__file__).resolve().parents[1]
source = (root / 'Shared/BluetoothPrinters.swift').read_text()
actor = source.split('private actor StarPrintSession {', 1)[1].split('\n#endif', 1)[0]
harness = r'''
import Foundation
struct StarConnectionSettings {
 enum Interface { case usb, bluetooth }
 init(interfaceType: Interface, identifier: String) {}
}
final class StarPrinter {
 static var opens = 0, closes = 0, probes = 0, writes = 0
 static var failWrite = false
 var getStatusTimeout = 5000
 init(_ settings: StarConnectionSettings) {}
 func open() async throws { Self.opens += 1 }
 func close() async { Self.closes += 1 }
 func getStatus() async throws -> Bool {
  precondition(getStatusTimeout == 1000)
  Self.probes += 1; return true
 }
 func print(raw: Data) async throws {
  Self.writes += 1
  if Self.failWrite { throw NSError(domain: "response-lost", code: 1) }
 }
}
'''
harness += '\nprivate actor StarPrintSession {' + actor
harness += r'''
@main struct Check {
 static func main() async {
  let session = StarPrintSession()
  let first = await session.prepare(identifier: "selected", usb: false)
  precondition(first == nil && StarPrinter.opens == 1 && StarPrinter.probes == 1)
  for _ in 0..<10 { _ = await session.prepare(identifier: "selected", usb: false) }
  precondition(StarPrinter.probes == 1, "healthy warm connection must skip repeated probes")
  let printed = await session.printReusing(identifier: "selected", usb: false, data: Data([1]))
  precondition(printed == nil && StarPrinter.opens == 1 && StarPrinter.closes == 0)
  _ = await session.prepare(identifier: "selected", usb: false)
  precondition(StarPrinter.probes == 1, "print traffic also refreshes readiness")
  _ = await session.prepare(identifier: "other", usb: false)
  precondition(StarPrinter.opens == 2 && StarPrinter.closes == 1 && StarPrinter.probes == 2)
  StarPrinter.failWrite = true
  let failed = await session.printReusing(identifier: "other", usb: false, data: Data([2]))
  precondition(failed == "print_uncertain" && StarPrinter.writes == 2 && StarPrinter.closes == 2,
               "a lost print response must not resend the receipt")
  StarPrinter.failWrite = false
  _ = await session.prepare(identifier: "other", usb: false)
  precondition(StarPrinter.opens == 3 && StarPrinter.probes == 3, "failure must invalidate readiness")
  print("PASS: warm probe suppression, connection reuse, target switch, uncertain-send protection, recovery")
 }
}
'''
with tempfile.TemporaryDirectory(prefix='tenpo-star-session-') as temp:
    path = Path(temp)
    (path / 'Check.swift').write_text(harness)
    subprocess.run(['swiftc', '-swift-version', '5', '-parse-as-library', '-module-cache-path', str(path / 'cache'), str(path / 'Check.swift'), '-o', str(path / 'check')], check=True)
    subprocess.run([str(path / 'check')], check=True)
