import XCTest
@testable import MeyeCore

final class MeyeCoreTests: XCTestCase {
    private var calendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(secondsFromGMT: 0)!
        return cal
    }
    private var anchor: Date { calendar.date(from: DateComponents(year: 2026, month: 10, day: 1, hour: 12))! }
    func testTodoTomorrowPM() {
        let card = CaptureParser().parse("remind me to call mom tomorrow at 5pm", day: anchor, calendar: calendar)
        XCTAssertEqual(card.kind, .todo)
        XCTAssertEqual(card.title, "Call mom")
        XCTAssertEqual(DayKey.string(card.date, calendar: calendar), "2026-10-02")
        XCTAssertEqual(calendar.component(.hour, from: card.startTime!), 17)
    }
    func testMorningCue() {
        let card = CaptureParser().parse("wake up at 7", day: anchor, calendar: calendar)
        XCTAssertEqual(calendar.component(.hour, from: card.startTime!), 7)
    }
    func testNotePreservesMidSentenceWords() {
        let card = CaptureParser().parse("note: I like running", day: anchor, calendar: calendar)
        XCTAssertEqual(card.kind, .note)
        XCTAssertEqual(card.title, "I like running")
    }
    func testExplicitKindWins() {
        let card = CaptureParser().parse("meeting tomorrow", kind: .note, day: anchor, calendar: calendar)
        XCTAssertEqual(card.kind, .note)
    }
    func testRoutineItemsAndTags() {
        let card = CaptureParser().parse("daily leg day: squats 3x12, lunges 3x15 #fitness", day: anchor, calendar: calendar)
        XCTAssertEqual(card.kind, .routine)
        XCTAssertEqual(card.title, "Leg day")
        XCTAssertEqual(card.items.map(\.title), ["Squats", "Lunges"])
        XCTAssertEqual(card.items.map(\.meta), ["3x12", "3x15"])
        XCTAssertEqual(card.tags, ["fitness"])
    }
    func testInvalidTimeStaysVisible() {
        let card = CaptureParser().parse("task at 25:99", day: anchor, calendar: calendar)
        XCTAssertNil(card.startTime)
        XCTAssertTrue(card.title.contains("25:99"))
    }
    func testCompletionIsDayScoped() {
        var card = CaptureParser().parse("gym", day: anchor, calendar: calendar)
        card.completedDays.insert(DayKey.string(anchor))
        XCTAssertTrue(card.isComplete(on: anchor))
        XCTAssertFalse(card.isComplete(on: calendar.date(byAdding: .day, value: 1, to: anchor)!))
    }
    func testArchiveRoundTrip() throws {
        let card = CaptureParser().parse("note: idea for an app", day: anchor, calendar: calendar)
        let archive = MeyeArchive(cards: [card])
        XCTAssertEqual(try MeyeArchive.decode(archive.encoded()), archive)
    }
    func testRejectsDuplicateIDs() throws {
        let card = CaptureParser().parse("buy milk", day: anchor, calendar: calendar)
        XCTAssertThrowsError(try MeyeArchive.decode(MeyeArchive(cards: [card, card]).encoded()))
    }
    func testRepositoryPersistsAndDoesNotResetCorruptData() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("cards.json")
        let repo = JSONCardRepository(url: url)
        let empty = try await repo.load()
        XCTAssertTrue(empty.cards.isEmpty)
        let archive = MeyeArchive(cards: [CaptureParser().parse("buy milk", day: anchor, calendar: calendar)])
        try await repo.save(archive)
        let loaded = try await repo.load()
        XCTAssertEqual(loaded, archive)
        try Data("broken".utf8).write(to: url)
        do { _ = try await repo.load(); XCTFail("Corrupt data must throw") } catch { }
        XCTAssertEqual(try String(contentsOf: url), "broken")
    }
}
