import SwiftUI

@main
struct MeyeApp: App {
    @StateObject private var model: MeyeViewModel
    @AppStorage("appearance") private var appearance = "system"

    init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        _model = StateObject(wrappedValue: MeyeViewModel(repository: JSONCardRepository(url: directory.appendingPathComponent("Meye/cards-v1.json"))))
    }
    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .tint(.indigo)
                .preferredColorScheme(appearance == "dark" ? .dark : (appearance == "light" ? .light : nil))
                .task { await model.load() }
                .alert("Meye", isPresented: Binding(get: { model.errorMessage != nil }, set: { if !$0 { model.errorMessage = nil } })) {
                    Button("OK") { model.errorMessage = nil }
                } message: { Text(model.errorMessage ?? "") }
        }
    }
}
