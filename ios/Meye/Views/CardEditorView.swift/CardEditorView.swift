import SwiftUI

struct CardEditorView: View {
    @State var card: MeyeCard
    var onSaved: () -> Void = {}
    @EnvironmentObject private var model: MeyeViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var hasTime = false
    @State private var tagText = ""
    @State private var initialized = false
    private var valid: Bool {
        !card.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        card.items.allSatisfy { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } &&
        (card.kind != .event || !hasTime || (card.endTime ?? card.date) > (card.startTime ?? card.date))
    }
    var body: some View {
        Form {
            Section("Card") {
                Picker("Type", selection: $card.kind) { ForEach(CardKind.allCases) { Text($0.label).tag($0) } }
                TextField("Title", text: $card.title, axis: .vertical)
                TextField("Details", text: $card.details, axis: .vertical).lineLimit(3...8)
            }
            Section("Schedule") {
                if card.kind == .routine { Text("Repeats daily. Each day has its own completion state.").foregroundStyle(.secondary) }
                else {
                    DatePicker("Day", selection: $card.date, displayedComponents: .date)
                        .onChange(of: card.date) { newDate in rebaseTimes(to: newDate) }
                }
                Toggle("Include time", isOn: $hasTime)
                    .onChange(of: hasTime) { enabled in
                        if enabled && card.startTime == nil {
                            card.startTime = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: card.date)
                            card.endTime = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: card.date)
                        }
                    }
                if hasTime {
                    DatePicker("Start", selection: Binding(get: { card.startTime ?? card.date }, set: { card.startTime = $0 }), displayedComponents: .hourAndMinute)
                    if card.kind == .event {
                        DatePicker("End", selection: Binding(get: { card.endTime ?? card.date }, set: { card.endTime = $0 }), displayedComponents: .hourAndMinute)
                        if !valid { Text("End must be after start. Overnight events are not supported yet.").font(.caption).foregroundStyle(.red) }
                    }
                }
                Text("Time is metadata only. No notifications or calendar sync in this version.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Context") {
                TextField("Location or platform", text: $card.location)
                TextField("Tags, separated by commas", text: $tagText)
            }
            if card.kind == .routine {
                Section("Routine items") {
                    ForEach($card.items) { $item in
                        VStack { TextField("Exercise or activity", text: $item.title); TextField("Sets / reps (optional)", text: $item.meta).font(.caption) }
                    }.onDelete { card.items.remove(atOffsets: $0) }
                    Button { card.items.append(RoutineItem(title: "")) } label: { Label("Add item", systemImage: "plus") }
                }
            }
        }.navigationTitle("Review card").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(model.isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(model.isSaving ? "Saving..." : "Save") {
                        Task {
                            var saved = card
                            saved.title = saved.title.trimmingCharacters(in: .whitespacesAndNewlines)
                            saved.tags = Array(Set(tagText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })).sorted()
                            if !hasTime { saved.startTime = nil; saved.endTime = nil }
                            if saved.kind != .event { saved.endTime = nil }
                            if saved.kind != .routine { saved.items = [] }
                            if await model.upsert(saved) { onSaved(); dismiss() }
                        }
                    }.disabled(!valid || model.isSaving || !model.storageReady)
                }
            }
            .interactiveDismissDisabled(model.isSaving)
            .onAppear {
                guard !initialized else { return }; initialized = true
                hasTime = card.startTime != nil; tagText = card.tags.joined(separator: ", ")
            }
    }
    private func rebaseTimes(to date: Date) {
        let calendar = Calendar.current
        if let time = card.startTime {
            card.startTime = calendar.date(bySettingHour: calendar.component(.hour, from: time), minute: calendar.component(.minute, from: time), second: 0, of: date)
        }
        if let time = card.endTime {
            card.endTime = calendar.date(bySettingHour: calendar.component(.hour, from: time), minute: calendar.component(.minute, from: time), second: 0, of: date)
        }
    }
}
