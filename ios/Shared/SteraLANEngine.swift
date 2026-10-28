import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

// Adapter boundary only. No stera wire format, discovery service or port is assumed here.
struct SteraLANTerminalIdentity: Codable, Equatable, Sendable {
    let terminalID: String
    let host: String
    let name: String
}

struct SteraLANAttempt: Codable, Equatable, Sendable {
    let id: String
    let orderID: String
    let terminalID: String
    let amount: Int
}

enum SteraLANOutcome: String, Codable, Sendable {
    case pending, unknown, succeeded, declined, canceled
    var isFinal: Bool { self == .succeeded || self == .declined || self == .canceled }
}

struct SteraLANResult: Codable, Equatable, Sendable {
    let attemptID: String
    let terminalID: String
    let amount: Int
    let outcome: SteraLANOutcome
    // The real adapter must verify the provider response, not merely a TCP connection.
    let providerVerified: Bool
}

struct SteraLANJournalRecord: Codable, Equatable, Sendable {
    let attempt: SteraLANAttempt
    var result: SteraLANResult?
    // A reservation without a response includes crashes/timeouts: treat it as unknown.
    var outcome: SteraLANOutcome { result?.outcome ?? .unknown }
    var isResolved: Bool { result?.providerVerified == true && result?.outcome.isFinal == true }
}

enum SteraLANError: Error, Equatable {
    case driverUnavailable, invalidConfiguration, invalidPayment, notConnected
    case operationInProgress, unresolvedAttempt, identityMismatch, responseMismatch
    case unverifiedResult, journalUnavailable, noPendingAttempt, notResolved
}

// Implementations must enforce bounded transport timeouts and never silently resend start().
protocol SteraLANDriver: Sendable {
    func discover(terminalID: String, manualHost: String?) async throws -> SteraLANTerminalIdentity
    func handshake(_ terminal: SteraLANTerminalIdentity) async throws -> SteraLANTerminalIdentity
    func start(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult
    func status(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult
    func cancel(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult
}

// Production stays unavailable until an actual documented stera driver is supplied.
struct UnavailableSteraLANDriver: SteraLANDriver {
    func discover(terminalID: String, manualHost: String?) async throws -> SteraLANTerminalIdentity { throw SteraLANError.driverUnavailable }
    func handshake(_ terminal: SteraLANTerminalIdentity) async throws -> SteraLANTerminalIdentity { throw SteraLANError.driverUnavailable }
    func start(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult { throw SteraLANError.driverUnavailable }
    func status(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult { throw SteraLANError.driverUnavailable }
    func cancel(_ attempt: SteraLANAttempt, terminal: SteraLANTerminalIdentity) async throws -> SteraLANResult { throw SteraLANError.driverUnavailable }
}

// reserve MUST durably and atomically reject an existing record before returning.
// update/acknowledge MUST compare the attempt ID; storage failures must retain a recoverable record.
// update returns the authoritative stored record if a concurrent session already resolved it.
protocol SteraLANJournal: Sendable {
    func load() async throws -> SteraLANJournalRecord?
    func reserve(_ attempt: SteraLANAttempt) async throws
    func update(_ result: SteraLANResult) async throws -> SteraLANJournalRecord
    func acknowledge(_ attemptID: String) async throws
}

// All sessions for a register must share this URL. flock also protects separate engine instances.
// Keep the directory in persistent app storage, never a temporary/cache directory.
actor SteraLANFileJournal: SteraLANJournal {
    private let url: URL
    init(url: URL) { self.url = url }

    private func locked<T>(_ operation: () throws -> T) throws -> T {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let fd = open(url.appendingPathExtension("lock").path, O_CREAT | O_RDWR, 0o600)
            guard fd >= 0 else { throw SteraLANError.journalUnavailable }
            defer { _ = close(fd) }
            guard flock(fd, LOCK_EX) == 0 else { throw SteraLANError.journalUnavailable }
            defer { _ = flock(fd, LOCK_UN) }
            return try operation()
        } catch let error as SteraLANError { throw error }
        catch { throw SteraLANError.journalUnavailable }
    }

    private func read() throws -> SteraLANJournalRecord? {
        do {
            return try JSONDecoder().decode(SteraLANJournalRecord.self, from: Data(contentsOf: url))
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            return nil
        }
        // Permission, protection and corruption errors must never look like an empty journal.
    }

    private func write(_ record: SteraLANJournalRecord) throws {
        #if os(iOS)
        let options: Data.WritingOptions = [.atomic, .completeFileProtectionUnlessOpen]
        #else
        let options: Data.WritingOptions = [.atomic]
        #endif
        try JSONEncoder().encode(record).write(to: url, options: options)
        // Flush the journal before allowing a payment request to leave this process.
        let fd = open(url.path, O_RDONLY)
        guard fd >= 0 else { throw SteraLANError.journalUnavailable }
        defer { _ = close(fd) }
        guard fsync(fd) == 0 else { throw SteraLANError.journalUnavailable }
        let directoryFD = open(url.deletingLastPathComponent().path, O_RDONLY)
        guard directoryFD >= 0 else { throw SteraLANError.journalUnavailable }
        defer { _ = close(directoryFD) }
        guard fsync(directoryFD) == 0 else { throw SteraLANError.journalUnavailable }
    }

    func load() throws -> SteraLANJournalRecord? { try locked { try read() } }
    func reserve(_ attempt: SteraLANAttempt) throws {
        try locked {
            guard try read() == nil else { throw SteraLANError.unresolvedAttempt }
            try write(SteraLANJournalRecord(attempt: attempt, result: nil))
        }
    }
    func update(_ result: SteraLANResult) throws -> SteraLANJournalRecord {
        try locked {
            guard var record = try read(), record.attempt.id == result.attemptID,
                  record.attempt.terminalID == result.terminalID, record.attempt.amount == result.amount else {
                throw SteraLANError.responseMismatch
            }
            guard !record.isResolved else { return record }
            record.result = result
            try write(record)
            return record
        }
    }
    func acknowledge(_ attemptID: String) throws {
        try locked {
            guard let record = try read(), record.attempt.id == attemptID else { throw SteraLANError.noPendingAttempt }
            guard record.isResolved else { throw SteraLANError.notResolved }
            try FileManager.default.removeItem(at: url)
        }
    }
}

actor SteraLANEngine {
    private let driver: any SteraLANDriver
    private let journal: any SteraLANJournal
    private var busy = false
    private(set) var connectedTerminal: SteraLANTerminalIdentity?

    init(driver: any SteraLANDriver = UnavailableSteraLANDriver(), journal: any SteraLANJournal) {
        self.driver = driver
        self.journal = journal
    }

    private func begin() throws {
        guard !busy else { throw SteraLANError.operationInProgress }
        busy = true
    }

    func pendingAttempt() async throws -> SteraLANJournalRecord? { try await journal.load() }

    @discardableResult
    func connect(terminalID: String, manualHost: String? = nil) async throws -> SteraLANTerminalIdentity {
        try begin()
        defer { busy = false }
        connectedTerminal = nil
        let id = terminalID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { throw SteraLANError.invalidConfiguration }
        if let record = try await journal.load(), record.attempt.terminalID != id { throw SteraLANError.unresolvedAttempt }
        let found = try await driver.discover(terminalID: id, manualHost: manualHost)
        guard found.terminalID == id, !found.host.isEmpty else { throw SteraLANError.identityMismatch }
        let verified = try await driver.handshake(found)
        guard verified.terminalID == id, !verified.host.isEmpty else { throw SteraLANError.identityMismatch }
        connectedTerminal = verified
        return verified
    }

    func disconnect() throws {
        try begin()
        defer { busy = false }
        connectedTerminal = nil
    }

    // Persist BEFORE sending. Never automatically retry this call after an uncertain outcome.
    func startPayment(orderID: String, amount: Int) async throws -> SteraLANJournalRecord {
        try begin()
        defer { busy = false }
        guard let terminal = connectedTerminal else { throw SteraLANError.notConnected }
        guard !orderID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, amount > 0, amount <= 99_999_999 else {
            throw SteraLANError.invalidPayment
        }
        let attempt = SteraLANAttempt(id: UUID().uuidString, orderID: orderID, terminalID: terminal.terminalID, amount: amount)
        try await journal.reserve(attempt)
        do { return try await accept(try await driver.start(attempt, terminal: terminal), attempt: attempt) }
        catch {
            // Original durable reservation remains even if recording an unknown outcome fails.
            connectedTerminal = nil
            throw error
        }
    }

    // Reconcile the SAME attempt after timeout/restart. This never calls start().
    func recoverPayment() async throws -> SteraLANJournalRecord { try await resolve(cancel: false) }
    func cancelPayment() async throws -> SteraLANJournalRecord { try await resolve(cancel: true) }

    private func resolve(cancel: Bool) async throws -> SteraLANJournalRecord {
        try begin()
        defer { busy = false }
        guard let record = try await journal.load() else { throw SteraLANError.noPendingAttempt }
        if record.isResolved { return record }
        guard let terminal = connectedTerminal else { throw SteraLANError.notConnected }
        guard terminal.terminalID == record.attempt.terminalID else { throw SteraLANError.identityMismatch }
        do {
            if cancel { return try await accept(try await driver.cancel(record.attempt, terminal: terminal), attempt: record.attempt) }
            return try await accept(try await driver.status(record.attempt, terminal: terminal), attempt: record.attempt)
        } catch {
            connectedTerminal = nil
            throw error
        }
    }

    private func accept(_ result: SteraLANResult,
                        attempt: SteraLANAttempt) async throws -> SteraLANJournalRecord {
        guard result.attemptID == attempt.id, result.terminalID == attempt.terminalID, result.amount == attempt.amount else {
            throw SteraLANError.responseMismatch
        }
        guard result.providerVerified else { throw SteraLANError.unverifiedResult }
        return try await journal.update(result)
    }

    // Caller must first durably record the verified outcome in the POS/order system.
    // A receipt/UI dismissal alone must never acknowledge a successful payment.
    func acknowledgeResolvedPayment(attemptID: String) async throws {
        try begin()
        defer { busy = false }
        try await journal.acknowledge(attemptID)
    }
}
