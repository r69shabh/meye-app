import Foundation

public protocol CardRepository: Sendable {
    func load() async throws -> MeyeArchive
    func save(_ archive: MeyeArchive) async throws
}

/// Actor isolation serializes file access. Atomic writes preserve the previous
/// file if writing fails. A corrupt file throws instead of silently resetting it.
public actor JSONCardRepository: CardRepository {
    private let url: URL
    public init(url: URL) { self.url = url }
    public func load() async throws -> MeyeArchive {
        guard FileManager.default.fileExists(atPath: url.path) else { return MeyeArchive() }
        return try MeyeArchive.decode(Data(contentsOf: url))
    }
    public func save(_ archive: MeyeArchive) async throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try archive.encoded().write(to: url, options: .atomic)
    }
}
