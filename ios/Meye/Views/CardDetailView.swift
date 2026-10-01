import SwiftUI

struct CardDetailView: View {
    let cardID: UUID
    @EnvironmentObject private var model: MeyeViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var editCard: MeyeCard?
    @State private var confirmDelete = false
    var body: some View {
        Group {
            if let card = model.card(cardID) {
                List {
                    Section { CardRow(card: card, day: model.selectedDate) }
                    if !card.details.isEmpty { Section("Details") { Text(card.details).textSelection(.enabled) } }
                    Section("Schedule") {
                        Text(card.isDaily ? "Daily" : card.date.formatted(date: .complete, time: .omitted))
                        if let start = card.startTime { LabeledContent("Start", value: start.formatted(date: .omitted, time: .shortened)) }
                        if let end = card.endTime { LabeledContent("End", value: end.formatted(date: .omitted, time: .shortened)) }
                    }
                    if card.kind == .todo || card.kind == .routine {
                        Section {
                            Button {
                                Task { await model.toggle(cardID, on: model.selectedDate) }
                            } label: { Label(card.isComplete(on: model.selectedDate) ? "Mark incomplete" : "Mark complete", systemImage: card.isComplete(on: model.selectedDate) ? "arrow.uturn.backward" : "checkmark.circle") }
                            .disabled(model.isSaving || !model.storageReady)
                        } header: { Text("Completion for \(model.selectedDate.formatted(date: .abbreviated, time: .omitted))") }
                    }
                    if card.kind == .routine && !card.items.isEmpty {
                        Section("Routine") {
                            ForEach(card.items) { item in
                                Button {
                                    Task { await model.toggleItem(item.id, cardID: cardID, on: model.selectedDate) }
                                } label: {
                                    HStack {
                                        Image(systemName: item.completedDays.contains(DayKey.string(model.selectedDate)) ? "checkmark.circle.fill" : "circle")
                                        VStack(alignment: .leading) { Text(item.title); if !item.meta.isEmpty { Text(item.meta).font(.caption).foregroundStyle(.secondary) } }
                                    }
                                }.buttonStyle(.plain).disabled(model.isSaving || !model.storageReady)
                            }
                        }
                    }
                    Section { Button("Delete card", role: .destructive) { confirmDelete = true }.disabled(model.isSaving || !model.storageReady) }
                }
                .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Edit") { editCard = card }.disabled(model.isSaving || !model.storageReady) } }
            } else { Text("This card was removed.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Card").navigationBarTitleDisplayMode(.inline)
        .sheet(item: $editCard) { card in NavigationStack { CardEditorView(card: card) } }
        .confirmationDialog("Delete this card and its completion history?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { if await model.delete(cardID) { dismiss() } } }
        }
    }
}
