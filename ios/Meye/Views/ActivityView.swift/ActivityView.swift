import SwiftUI

struct ActivityView: View {
    @EnvironmentObject private var model: MeyeViewModel
    private var days: [Date] {
        (-27...0).compactMap { Calendar.current.date(byAdding: .day, value: $0, to: Calendar.current.startOfDay(for: Date())) }
    }
    private var total: Int { days.reduce(0) { $0 + model.completions(on: $1) } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(total)").font(.system(size: 48, weight: .bold, design: .rounded))
                    Text("completed cards in the last 28 days").foregroundStyle(.secondary)
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 7), spacing: 10) {
                    ForEach(days, id: \.self) { day in
                        let count = model.completions(on: day)
                        RoundedRectangle(cornerRadius: 8)
                            .fill(count == 0 ? Color.secondary.opacity(0.10) : Color.indigo.opacity(min(0.25 + Double(count) * 0.15, 1)))
                            .aspectRatio(1, contentMode: .fit)
                            .overlay(Text(day.formatted(.dateTime.day())).font(.caption))
                            .accessibilityLabel("\(day.formatted(date: .abbreviated, time: .omitted)): \(count) completed")
                    }
                }
                HStack { Text("Less"); ForEach(0..<5) { i in RoundedRectangle(cornerRadius: 3).fill(Color.indigo.opacity(Double(i + 1) * 0.2)).frame(width: 16, height: 16) }; Text("More") }.font(.caption).foregroundStyle(.secondary)
                Text("Your daily routines") .font(.title3.weight(.semibold))
                if model.cards.filter({ $0.kind == .routine }).isEmpty { Text("Add a routine to start tracking it.").foregroundStyle(.secondary) }
                ForEach(model.cards.filter { $0.kind == .routine }) { card in
                    HStack {
                        VStack(alignment: .leading) { Text(card.title).font(.headline); Text("\(card.completedDays.count) completed days").font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                        Image(systemName: card.kind.symbol).foregroundStyle(.indigo)
                    }.padding().background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 16))
                }
                Text("History belongs to each card. Deleting a card also deletes its history. No sample activity is counted.").font(.caption).foregroundStyle(.secondary)
            }.padding()
        }.navigationTitle("Activity")
    }
}
