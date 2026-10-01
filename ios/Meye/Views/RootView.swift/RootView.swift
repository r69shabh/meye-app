import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            NavigationStack { DayFeedView() }.tabItem { Label("Today", systemImage: "square.grid.2x2") }
            NavigationStack { ActivityView() }.tabItem { Label("Activity", systemImage: "chart.bar.xaxis") }
            NavigationStack { SettingsView() }.tabItem { Label("Settings", systemImage: "gearshape") }
        }
    }
}

struct DayFeedView: View {
    @EnvironmentObject private var model: MeyeViewModel
    @State private var showCapture = false
    @State private var showDatePicker = false
    private var week: [Date] {
        let calendar = Calendar.current
        let start = calendar.dateInterval(of: .weekOfYear, for: model.selectedDate)?.start ?? model.selectedDate
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Button { shiftWeek(-7) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Previous week")
                Spacer()
                Button { showDatePicker = true } label: { Text(model.selectedDate.formatted(.dateTime.month(.wide).year())).font(.headline) }
                Spacer()
                Button { shiftWeek(7) } label: { Image(systemName: "chevron.right") }.accessibilityLabel("Next week")
            }.padding(.horizontal).padding(.top, 12)
            HStack(spacing: 4) {
                ForEach(week, id: \.self) { day in
                    let selected = Calendar.current.isDate(day, inSameDayAs: model.selectedDate)
                    Button { model.selectedDate = day } label: {
                        VStack(spacing: 8) {
                            Text(day.formatted(.dateTime.weekday(.narrow))).font(.caption)
                            Text(day.formatted(.dateTime.day())).font(.headline)
                            Circle().fill(Calendar.current.isDateInToday(day) ? Color.indigo : Color.clear).frame(width: 4, height: 4)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(selected ? Color.indigo.opacity(0.14) : Color.clear, in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(day.formatted(date: .complete, time: .omitted))
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }.padding()
            if model.isLoading { Spacer(); ProgressView("Loading your day"); Spacer() }
            else if model.visibleCards.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "sparkle").font(.largeTitle).foregroundStyle(.indigo)
                    Text(model.searchText.isEmpty ? "A little space for your day." : "No matching cards.").font(.title3.weight(.semibold))
                    Text(model.searchText.isEmpty ? "Capture a thought, a task or a routine below." : "Try another word.").foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.padding()
                Spacer()
            } else {
                List {
                    Section {
                        ForEach(model.visibleCards) { card in
                            NavigationLink { CardDetailView(cardID: card.id) } label: { CardRow(card: card, day: model.selectedDate) }
                        }
                    } header: { Text("\(model.visibleCards.count) cards · \(model.completionCount) completed") }
                }.listStyle(.insetGrouped)
            }
        }
        .navigationTitle("meye")
        .toolbar { ToolbarItem(placement: .navigationBarTrailing) { Button("Today") { model.selectedDate = Date() } } }
        .searchable(text: $model.searchText, prompt: "Search this day")
        .safeAreaInset(edge: .bottom) {
            Button { showCapture = true } label: {
                HStack { Image(systemName: "plus.circle.fill"); Text("What's on your mind..."); Spacer(); Image(systemName: "arrow.up") }
                .padding().background(Color.indigo, in: Capsule()).foregroundStyle(.white)
            }.padding().background(.ultraThinMaterial)
                .disabled(!model.storageReady || model.isSaving)
        }
        .sheet(isPresented: $showCapture) { NavigationStack { CaptureView(day: model.selectedDate) } }
        .sheet(isPresented: $showDatePicker) {
            NavigationStack {
                DatePicker("Choose a day", selection: $model.selectedDate, displayedComponents: .date)
                    .datePickerStyle(.graphical).padding().navigationTitle("Go to date")
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showDatePicker = false } } }
            }.presentationDetents([.medium, .large])
        }
    }
    private func shiftWeek(_ delta: Int) {
        model.selectedDate = Calendar.current.date(byAdding: .day, value: delta, to: model.selectedDate) ?? model.selectedDate
    }
}

struct CardRow: View {
    let card: MeyeCard
    let day: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(card.kind.label, systemImage: card.kind.symbol).font(.caption.weight(.semibold)).foregroundStyle(.indigo)
                Spacer()
                if card.isComplete(on: day) { Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).accessibilityLabel("Completed") }
            }
            Text(card.title).font(.headline).strikethrough(card.isComplete(on: day))
            if let time = card.startTime { Label(time.formatted(date: .omitted, time: .shortened), systemImage: "clock").font(.caption).foregroundStyle(.secondary) }
            if card.isDaily { Text("Daily · \(card.items.count) items").font(.caption).foregroundStyle(.secondary) }
            if !card.location.isEmpty { Label(card.location, systemImage: "mappin").font(.caption).foregroundStyle(.secondary) }
            if !card.tags.isEmpty { Text(card.tags.map { "#" + $0 }.joined(separator: " ")).font(.caption).foregroundStyle(.secondary) }
        }.padding(.vertical, 6)
    }
}
