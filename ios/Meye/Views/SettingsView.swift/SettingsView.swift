import SwiftUI
import UniformTypeIdentifiers

struct BackupDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data = Data()) { self.data = data }
    init(configuration: ReadConfiguration) throws { data = configuration.file.regularFileContents ?? Data() }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper { FileWrapper(regularFileWithContents: data) }
}

struct SettingsView: View {
    @EnvironmentObject private var model: MeyeViewModel
    @AppStorage("appearance") private var appearance = "system"
    @State private var exporting = false
    @State private var importing = false
    @State private var backup = BackupDocument()
    @State private var pendingImport: Data?
    @State private var confirmImport = false
    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $appearance) {
                    Text("System").tag("system"); Text("Light").tag("light"); Text("Dark").tag("dark")
                }
            }
            Section("Your data") {
                LabeledContent("Cards stored on this device", value: "\(model.cards.count)")
                Button("Export JSON backup") {
                    do { backup = BackupDocument(data: try MeyeArchive(cards: model.cards).encoded()); exporting = true }
                    catch { model.errorMessage = error.localizedDescription }
                }.disabled(!model.storageReady || model.isSaving)
                Button("Import JSON backup") { importing = true }.disabled(!model.storageReady || model.isSaving)
                Text("Import replaces all cards and their history. Export first to keep a copy. This is the iOS v1 format, not the original web app's JSON.").font(.caption).foregroundStyle(.secondary)
            }
            Section("About this port") {
                Text("Meye for iOS").font(.headline)
                Text("Native SwiftUI · local-first · MVVM")
                Text("Notes, to-dos, events and daily routines. No account required.")
                Text("Voice dictation, OAuth sync, exercise artwork and notifications are not included yet. This app has not been published to the App Store.").font(.caption).foregroundStyle(.secondary)
            }
        }.navigationTitle("Settings")
            .fileExporter(isPresented: $exporting, document: backup, contentType: .json, defaultFilename: "meye-ios-backup") { result in
                if case .failure(let error) = result { model.errorMessage = "Export failed: \(error.localizedDescription)" }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                do {
                    let url = try result.get()
                    let access = url.startAccessingSecurityScopedResource()
                    defer { if access { url.stopAccessingSecurityScopedResource() } }
                    let data = try Data(contentsOf: url)
                    _ = try MeyeArchive.decode(data)
                    pendingImport = data; confirmImport = true
                } catch { model.errorMessage = "Could not read backup: \(error.localizedDescription)" }
            }
            .confirmationDialog("Replace all \(model.cards.count) cards with this backup?", isPresented: $confirmImport, titleVisibility: .visible) {
                Button("Replace all cards", role: .destructive) {
                    if let data = pendingImport { Task { _ = await model.importBackup(data); pendingImport = nil } }
                }
                Button("Cancel", role: .cancel) { pendingImport = nil }
            }
    }
}
