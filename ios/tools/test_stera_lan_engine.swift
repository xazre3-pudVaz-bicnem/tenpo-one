// Run from repository root:
// swiftc -swift-version 6 -module-cache-path /tmp/tenpo-stera-engine-cache \
//   ios/Shared/SteraLANEngine.swift ios/tools/test_stera_lan_engine.swift \
//   -o /tmp/tenpo-stera-engine-test && /tmp/tenpo-stera-engine-test
import Foundation

private enum TestFailure: Error { case assertion(String), timeout }
private enum Reply: Sendable { case success, pending, unknown, timeout, wrongID, wrongTerminal, wrongAmount, unverified, canceled }

// Simulates responses only. Never included in the app target or used as a production driver.
private actor FakeDriver: SteraLANDriver {
    var discoveredID = "T1"
    var handshakeID = "T1"
    var reply: Reply = .success
    var startIDs: [String] = []
    var statusIDs: [String] = []
    var cancelIDs: [String] = []
    var held = false
    var releaseContinuation: CheckedContinuation<Void, Never>?
    var startedContinuation: CheckedContinuation<Void, Never>?

    func configure(discoveredID: String = "T1", handshakeID: String = "T1", reply: Reply = .success, held: Bool = false) {
        self.discoveredID = discoveredID
        self.handshakeID = handshakeID
        self.reply = reply
        self.held = held
    }
    func discover(terminalID: String, manualHost: String?) async throws -> SteraLANTerminalIdentity {
        SteraLANTerminalIdentity(terminalID: discoveredID, host: manualHost ?? "192.168.1.20", name: "Test terminal")
    }
    func handshake(_ terminal: SteraLANTerminalIdentity) async throws -> SteraLANTerminalIdentity {
        SteraLANTerminalIdentity(terminalID: handshakeID, host: terminal.host, name: terminal.name)
    }
    func start(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult {
        startIDs.append(attempt.id)
        await pauseIfHeld()
        return try response(attempt)
    }
    private func pauseIfHeld() async {
        if held {
            await withCheckedContinuation { continuation in
                releaseContinuation = continuation
                startedContinuation?.resume()
                startedContinuation = nil
            }
        }
    }
    func waitUntilStarted() async {
        if releaseContinuation != nil { return }
        await withCheckedContinuation { startedContinuation = $0 }
    }
    func release() { releaseContinuation?.resume(); releaseContinuation = nil }
    func status(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult {
        statusIDs.append(attempt.id)
        await pauseIfHeld()
        return try response(attempt)
    }
    func cancel(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult {
        cancelIDs.append(attempt.id)
        await pauseIfHeld()
        return try response(attempt)
    }
    private func response(_ attempt: SteraLANAttempt) throws -> SteraLANResult {
        if reply == .timeout { throw TestFailure.timeout }
        return SteraLANResult(attemptID: reply == .wrongID ? "OTHER" : attempt.id,
                              terminalID: reply == .wrongTerminal ? "OTHER" : attempt.terminalID,
                              amount: attempt.amount + (reply == .wrongAmount ? 1 : 0),
                              outcome: reply == .pending ? .pending : reply == .unknown ? .unknown : reply == .canceled ? .canceled : .succeeded,
                              providerVerified: reply != .unverified)
    }
}

private actor FailingJournal: SteraLANJournal {
    func load() async throws -> SteraLANJournalRecord? { nil }
    func reserve(_ attempt: SteraLANAttempt) async throws { throw SteraLANError.journalUnavailable }
    func update(_ result: SteraLANResult) async throws -> SteraLANJournalRecord { throw SteraLANError.journalUnavailable }
    func acknowledge(_ attemptID: String) async throws { throw SteraLANError.journalUnavailable }
}

@main @MainActor private struct SteraLANEngineTests {
    static func check(_ value: Bool, _ description: String) throws {
        if !value { throw TestFailure.assertion(description) }
    }
    static func expect(_ expected: SteraLANError, _ body: () async throws -> Void) async throws {
        do { try await body(); throw TestFailure.assertion("Expected \(expected)") }
        catch let error as SteraLANError { try check(error == expected, "Expected \(expected), got \(error)") }
    }
    static func journal(_ root: URL, _ name: String) -> SteraLANFileJournal {
        SteraLANFileJournal(url: root.appendingPathComponent(name + ".json"))
    }
    static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("stera-engine-tests-" + UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        var tests = 0
        let driver = FakeDriver()
        let engine = SteraLANEngine(driver: driver, journal: journal(root, "identity"))
        await driver.configure(discoveredID: "WRONG")
        try await expect(.identityMismatch) { _ = try await engine.connect(terminalID: "T1") }
        try check(await engine.connectedTerminal == nil, "Discovery ID mismatch must not connect")
        await driver.configure(handshakeID: "WRONG")
        try await expect(.identityMismatch) { _ = try await engine.connect(terminalID: "T1") }
        try check(await engine.connectedTerminal == nil, "Handshake ID mismatch must not connect")
        tests += 2

        let unavailable = SteraLANEngine(journal: journal(root, "unavailable"))
        try await expect(.driverUnavailable) { _ = try await unavailable.connect(terminalID: "T1") }
        tests += 1

        await driver.configure(held: true)
        _ = try await engine.connect(terminalID: "T1")
        let first = Task { try await engine.startPayment(orderID: "ORDER1", amount: 2980) }
        await driver.waitUntilStarted()
        try await expect(.operationInProgress) { _ = try await engine.startPayment(orderID: "ORDER1", amount: 2980) }
        try await expect(.operationInProgress) { try await engine.disconnect() }
        await driver.release()
        let success = try await first.value
        try check(success.isResolved, "Verified matching success must resolve")
        try check(await driver.startIDs.count == 1, "Concurrent presses must send exactly once")
        try await expect(.unresolvedAttempt) { _ = try await engine.startPayment(orderID: "ORDER1", amount: 2980) }
        tests += 2

        let restored = SteraLANEngine(driver: driver, journal: journal(root, "identity"))
        let cached = try await restored.recoverPayment()
        try check(cached == success, "Verified final must survive restart without resending")
        try check(await driver.statusIDs.isEmpty, "Persisted final must not be queried again")
        try await restored.acknowledgeResolvedPayment(attemptID: success.attempt.id)
        try check(try await restored.pendingAttempt() == nil, "Explicit acknowledged final can clear")
        tests += 1

        // A timeout can follow a successful charge. A new engine must never resend it.
        let timeoutJournal = journal(root, "timeout")
        let uncertain = SteraLANEngine(driver: driver, journal: timeoutJournal)
        await driver.configure(reply: .timeout)
        _ = try await uncertain.connect(terminalID: "T1")
        do { _ = try await uncertain.startPayment(orderID: "ORDER2", amount: 4500); throw TestFailure.assertion("Expected timeout") }
        catch TestFailure.timeout { }
        guard let pending = try await uncertain.pendingAttempt() else { throw TestFailure.assertion("Timeout must preserve reservation") }
        try check(!pending.isResolved, "Timeout must not resolve")
        try await expect(.notResolved) { try await uncertain.acknowledgeResolvedPayment(attemptID: pending.attempt.id) }
        let afterRestart = SteraLANEngine(driver: driver, journal: journal(root, "timeout"))
        try await expect(.unresolvedAttempt) { _ = try await afterRestart.connect(terminalID: "T2") }
        await driver.configure()
        _ = try await afterRestart.connect(terminalID: "T1", manualHost: "192.168.1.30")
        try await expect(.unresolvedAttempt) { _ = try await afterRestart.startPayment(orderID: "ORDER2", amount: 4500) }
        let recovered = try await afterRestart.recoverPayment()
        try check(recovered.isResolved && recovered.attempt == pending.attempt, "Recovery must use original attempt")
        try check(await driver.statusIDs == [pending.attempt.id], "Only original attempt ID is queried")
        try check(await driver.startIDs.count == 2, "Recovery must never call start")
        tests += 3

        for (index, reply) in [Reply.wrongID, .wrongTerminal, .wrongAmount, .unverified].enumerated() {
            let mismatch = SteraLANEngine(driver: driver, journal: journal(root, "mismatch\(index)"))
            await driver.configure(reply: reply)
            _ = try await mismatch.connect(terminalID: "T1")
            try await expect(reply == .unverified ? .unverifiedResult : .responseMismatch) {
                _ = try await mismatch.startPayment(orderID: "MISMATCH", amount: 3000)
            }
            let record = try await mismatch.pendingAttempt()
            try check(record != nil && record?.isResolved == false, "Invalid response must retain unresolved attempt")
            try check(await mismatch.connectedTerminal == nil, "Invalid response requires reconnect")
            tests += 1
        }

        let cancelEngine = SteraLANEngine(driver: driver, journal: journal(root, "cancel"))
        await driver.configure(reply: .unknown)
        _ = try await cancelEngine.connect(terminalID: "T1")
        let unknown = try await cancelEngine.startPayment(orderID: "CANCEL", amount: 5000)
        try check(!unknown.isResolved, "Unknown response is unresolved")
        await driver.configure(reply: .timeout)
        do { _ = try await cancelEngine.cancelPayment(); throw TestFailure.assertion("Expected cancel timeout") }
        catch TestFailure.timeout { }
        try check(try await cancelEngine.pendingAttempt()?.isResolved == false, "Cancel request is not a canceled result")
        await driver.configure(reply: .success)
        _ = try await cancelEngine.connect(terminalID: "T1")
        let race = try await cancelEngine.recoverPayment()
        try check(race.result?.outcome == .succeeded, "Status can reveal success after cancel timeout")
        try check(await driver.cancelIDs == [unknown.attempt.id], "Cancel must use original ID")
        tests += 2

        let failedStorage = SteraLANEngine(driver: driver, journal: FailingJournal())
        _ = try await failedStorage.connect(terminalID: "T1")
        let count = await driver.startIDs.count
        try await expect(.journalUnavailable) { _ = try await failedStorage.startPayment(orderID: "FAIL", amount: 1000) }
        try check(await driver.startIDs.count == count, "Storage failure must prevent payment send")
        tests += 1

        // Two separate actors sharing one register journal must not both reserve.
        let shared1 = journal(root, "shared"), shared2 = journal(root, "shared")
        let a = SteraLANAttempt(id: "A", orderID: "O", terminalID: "T1", amount: 100)
        let b = SteraLANAttempt(id: "B", orderID: "O", terminalID: "T1", amount: 100)
        let reservations = await withTaskGroup(of: Bool.self, returning: [Bool].self) { group in
            group.addTask { do { try await shared1.reserve(a); return true } catch { return false } }
            group.addTask { do { try await shared2.reserve(b); return true } catch { return false } }
            var values: [Bool] = []
            for await result in group { values.append(result) }
            return values
        }
        try check(reservations.filter { $0 }.count == 1, "Shared journal must reserve exactly once")
        tests += 1
        // A slow status response cannot overwrite or contradict a final from another session.
        let raceJournal = journal(root, "race")
        let raceAttempt = SteraLANAttempt(id: "RACE", orderID: "O", terminalID: "T1", amount: 200)
        try await raceJournal.reserve(raceAttempt)
        let slowDriver = FakeDriver(), cancelDriver = FakeDriver()
        await slowDriver.configure(reply: .success, held: true)
        await cancelDriver.configure(reply: .canceled)
        let slowEngine = SteraLANEngine(driver: slowDriver, journal: raceJournal)
        let otherEngine = SteraLANEngine(driver: cancelDriver, journal: journal(root, "race"))
        _ = try await slowEngine.connect(terminalID: "T1")
        _ = try await otherEngine.connect(terminalID: "T1")
        let slowStatus = Task { try await slowEngine.recoverPayment() }
        await slowDriver.waitUntilStarted()
        let winner = try await otherEngine.cancelPayment()
        await slowDriver.release()
        let late = try await slowStatus.value
        try check(winner == late && late.result?.outcome == .canceled,
                  "Concurrent engines must return the durable final winner")
        tests += 1

        let corruptURL = root.appendingPathComponent("corrupt.json")
        try Data("invalid journal".utf8).write(to: corruptURL)
        let corruptEngine = SteraLANEngine(driver: driver, journal: SteraLANFileJournal(url: corruptURL))
        try await expect(.journalUnavailable) { _ = try await corruptEngine.connect(terminalID: "T1") }
        try check(await driver.startIDs.count == count, "Corrupt storage must fail closed without sending")
        tests += 1
        print("PASS: \(tests) stera LAN engine safety scenarios (fake driver only; no terminal communication)")
    }
}
