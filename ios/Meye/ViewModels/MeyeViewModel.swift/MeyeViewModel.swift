import Foundation
import SwiftUI

@MainActor
final class MeyeViewModel: ObservableObject {
    @Published private(set) var cards: [MeyeCard] = []
    @Published private(set) var isLoading = true
    @Published private(set) var isSaving = false
    @Published private(set) var storageReady = false
    @Published var selectedDate = Date()
    @Published var searchText = ""
    @Published var errorMessage: String?
    private let repository: any CardRepository
    private var didLoad = false

    init(repository: any CardRepository) { self.repository = repository }

    func load() async {
        guard !didLoad else { return }
        didLoad = true
        defer { isLoading = false }
        do { cards = try await repository.load().cards; storageReady = true }
        catch { errorMessage = "Could not read your saved data: \(error.localizedDescription) Writing is disabled to protect the original file." }
    }

    var visibleCards: [MeyeCard] {
        cards.filter { card in
            (card.isDaily || Calendar.current.isDate(card.date, inSameDayAs: selectedDate)) &&
            (searchText.isEmpty || (card.title + " " + card.details + " " + card.tags.joined(separator: " ")).localizedCaseInsensitiveContains(searchText))
        }.sorted { lhs, rhs in
            if lhs.isComplete(on: selectedDate) != rhs.isComplete(on: selectedDate) { return !lhs.isComplete(on: selectedDate) }
            if let l = lhs.startTime, let r = rhs.startTime { return l < r }
            if (lhs.startTime != nil) != (rhs.startTime != nil) { return lhs.startTime != nil }
            return lhs.createdAt > rhs.createdAt
        }
    }
    var completionCount: Int { visibleCards.filter { $0.isComplete(on: selectedDate) }.count }
    func card(_ id: UUID) -> MeyeCard? { cards.first { $0.id == id } }

    // Transactional: commit UI state only after the file is saved. No detached
    // save tasks and no stale snapshots racing to replace newer edits.
    private func persist(_ next: [MeyeCard]) async -> Bool {
        guard storageReady && !isSaving else { return false }
        isSaving = true
        defer { isSaving = false }
        do { try await repository.save(MeyeArchive(cards: next)); cards = next; return true }
        catch { errorMessage = "Could not save: \(error.localizedDescription). Your change was not applied."; return false }
    }
    func upsert(_ card: MeyeCard) async -> Bool {
        guard !card.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        var next = cards
        if let i = next.firstIndex(where: { $0.id == card.id }) { next[i] = card } else { next.insert(card, at: 0) }
        return await persist(next)
    }
    func delete(_ id: UUID) async -> Bool { await persist(cards.filter { $0.id != id }) }
    func toggle(_ id: UUID, on day: Date) async {
        guard var card = card(id), card.kind == .todo || card.kind == .routine else { return }
        let key = DayKey.string(day)
        let done = !card.completedDays.contains(key)
        if done { card.completedDays.insert(key) } else { card.completedDays.remove(key) }
        if card.kind == .routine {
            for i in card.items.indices {
                if done { card.items[i].completedDays.insert(key) } else { card.items[i].completedDays.remove(key) }
            }
        }
        _ = await upsert(card)
    }
    func toggleItem(_ itemID: UUID, cardID: UUID, on day: Date) async {
        guard var card = card(cardID), let index = card.items.firstIndex(where: { $0.id == itemID }) else { return }
        let key = DayKey.string(day)
        if card.items[index].completedDays.contains(key) { card.items[index].completedDays.remove(key) }
        else { card.items[index].completedDays.insert(key) }
        if !card.items.isEmpty && card.items.allSatisfy({ $0.completedDays.contains(key) }) { card.completedDays.insert(key) }
        else { card.completedDays.remove(key) }
        _ = await upsert(card)
    }
    func importBackup(_ data: Data) async -> Bool {
        do { let archive = try MeyeArchive.decode(data); return await persist(archive.cards) }
        catch { errorMessage = "Could not import: \(error.localizedDescription)"; return false }
    }
    func completions(on date: Date) -> Int {
        cards.filter { $0.completedDays.contains(DayKey.string(date)) }.count
    }
}
