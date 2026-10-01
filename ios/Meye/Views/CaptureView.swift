import SwiftUI

struct CaptureView: View {
    let day: Date
    @State private var text = ""
    @State private var selectedType = "auto"
    @State private var draft: MeyeCard?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("A thought, a plan, a little progress.").font(.title2.weight(.semibold))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack {
                    chip("Auto", value: "auto")
                    ForEach(CardKind.allCases) { kind in chip(kind.label, value: kind.rawValue) }
                }
            }
            TextEditor(text: $text).frame(minHeight: 140, maxHeight: 220)
                .padding(8).background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
                .accessibilityLabel("Capture text")
            Text("Try 'remind me to call mom tomorrow at 5pm' or 'daily leg day: squats 3x12, lunges 3x15'. Use commas between routine items.")
                .font(.callout).foregroundStyle(.secondary)
            Text("Dates are based on the day you have selected. Review everything before saving. This version does not send reminders.")
                .font(.caption).foregroundStyle(.secondary)
            Button {
                draft = CaptureParser().parse(text, kind: CardKind(rawValue: selectedType), day: day)
            } label: { Text("Review capture").frame(maxWidth: .infinity).padding(8) }
                .buttonStyle(.borderedProminent).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            Spacer()
        }.padding().navigationTitle("Capture").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .sheet(item: $draft) { card in
                NavigationStack { CardEditorView(card: card, onSaved: { dismiss() }) }
            }
    }
    private func chip(_ label: String, value: String) -> some View {
        Button { selectedType = value } label: {
            Text(label).font(.subheadline.weight(.medium)).padding(.horizontal, 14).padding(.vertical, 10)
                .background(selectedType == value ? Color.indigo.opacity(0.18) : Color.secondary.opacity(0.08), in: Capsule())
        }.buttonStyle(.plain).accessibilityAddTraits(selectedType == value ? .isSelected : [])
    }
}
