import Foundation

public enum CardKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case note, todo, event, routine
    public var id: String { rawValue }
    public var label: String {
        switch self { case .note: return "Note"; case .todo: return "To-do"; case .event: return "Event"; case .routine: return "Routine" }
    }
    public var symbol: String {
        switch self { case .note: return "note.text"; case .todo: return "checkmark.circle"; case .event: return "calendar"; case .routine: return "arrow.triangle.2.circlepath" }
    }
}

public struct RoutineItem: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var title: String
    public var meta: String = ""
    // Day keys, not a single boolean: yesterday's workout must not check today's.
    public var completedDays: Set<String> = []
}

public struct MeyeCard: Identifiable, Codable, Equatable, Sendable {
    public var id = UUID()
    public var kind: CardKind
    public var title: String
    public var details: String = ""
    public var date: Date
    public var startTime: Date? = nil
    public var endTime: Date? = nil
    public var location: String = ""
    public var tags: [String] = []
    public var items: [RoutineItem] = []
    public var completedDays: Set<String> = []
    public var createdAt = Date()
    public var isDaily: Bool { kind == .routine }
    public func isComplete(on day: Date) -> Bool { completedDays.contains(DayKey.string(day)) }
}

public enum DayKey {
    public static func string(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

public struct MeyeArchive: Codable, Equatable, Sendable {
    public var version = 1
    public var cards: [MeyeCard] = []
    public init(cards: [MeyeCard] = []) { self.cards = cards }
    public static func decode(_ data: Data) throws -> Self {
        let archive = try JSONDecoder().decode(Self.self, from: data)
        guard archive.version == 1 else { throw ArchiveError.unsupportedVersion }
        guard Set(archive.cards.map(\.id)).count == archive.cards.count,
              archive.cards.allSatisfy({ !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && Set($0.items.map(\.id)).count == $0.items.count }) else {
            throw ArchiveError.invalidCards
        }
        return archive
    }
    public func encoded() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return try encoder.encode(self)
    }
}

public enum ArchiveError: LocalizedError {
    case unsupportedVersion, invalidCards
    public var errorDescription: String? {
        switch self {
        case .unsupportedVersion: return "This backup version is not supported. No data was changed."
        case .invalidCards: return "The backup contains empty titles or duplicate IDs. No data was changed."
        }
    }
}
