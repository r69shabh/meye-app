# Meye for iOS

A native SwiftUI port of the core Meye productivity workflow: capture a thought,
organize a day, and track daily routines. Local-first, built with MVVM and Swift
concurrency. This is a development project, not an App Store release.

## Run on your Mac

Requirements: Xcode 15 or newer, an iOS 17+ simulator (or iPhone/iPad running iOS
17+). No third-party packages, Node, CocoaPods or backend are needed. The build
decodes the bundled icon from `Resources/AppIcon.base64` before compiling assets.

1. Open `Meye.xcodeproj` in Xcode.
2. Choose the **Meye** scheme and an installed iPhone simulator.
3. Press **Cmd+R**. The first launch is intentionally empty. Tap the capture pill.
4. For a physical device, choose your own development team under **Signing &
   Capabilities** and change the bundle identifier if Xcode asks. No team or
   signing credentials are committed.

From Terminal with Xcode selected:

```sh
swift test
xcodebuild -project Meye.xcodeproj -scheme Meye \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

`swift test` tests the Foundation-only core package. The app scheme does not
contain an XCTest target; run the package tests from Terminal or open
`Package.swift` separately in Xcode.

## Implemented

- Real tab navigation: date feed, activity, settings.
- Week strip, previous/next week, Today button and arbitrary date picker.
- Day-scoped search, empty state and card detail navigation.
- Auto / Note / To-do / Event / Routine composer with review before saving.
- Editable title, details, type, date, time, location/platform, tags, routine items.
- Task completion and daily routine/sub-item completion, scoped to each day.
- 28-day completion heatmap and routine totals. No invented sample activity.
- System/light/dark appearance.
- Atomic JSON persistence in Application Support, asynchronous actor-backed
  storage, save/load errors and no silent reset of corrupt data.
- JSON backup export and validated, explicitly confirmed replacement import.
- Foundation unit tests for parsing, day completion, archive integrity and disk
  round trips.

## What is intentionally different

This is a native reimplementation, not a WebView or Capacitor wrapper. It follows
the original `r69shabh/meye` card types and date-feed/composer workflow, with a
smaller parser. The companion `meye-app` repo was checked for packaging and
Whisper/sync context, not copied into iOS.

Supported automatic capture includes `today`, `tomorrow`, `day after tomorrow`,
`at 5pm`, `at 07:30`, explicit daily routines, `#tags`, and comma-separated routine
items with `3x12` metadata. Bare hours 1-8 lean PM unless the text contains a
morning/wake cue, matching the original parser's simple rule. Relative dates use
the selected day. Explicit type selection wins; every result is editable.

Examples:

```text
remind me to call mom tomorrow at 5pm
note: I like running
meeting with Ana tomorrow at 2pm
 daily leg day: squats 3x12, lunges 3x15 #fitness
```

Not ported yet: voice/Whisper dictation, GitHub Gist OAuth sync, Google Calendar
sync, scheduled notifications, exercise artwork/matching, onboarding tour,
weekday/month/range NLP, non-daily recurrence, indefinite/anytime tasks, overnight
or multi-day events, web JSON migration, custom accent colors and historical
analytics beyond completion counts. Times are metadata only, not reminders.
Routine items need separators; there is no implicit exercise-name splitting.

Backups use the **iOS v1 schema**, not the web app's `allCards/stats/prefs` schema.
Import replaces all iOS cards and history, only after review. Appearance is a
separate local preference and is not included in a backup. Deleting a card deletes
its history. Dates and day keys use the device calendar/time zone; this first
version does not migrate history across time-zone/calendar changes.

## Architecture

```text
MeyeApp
  RootView / DayFeedView / CaptureView / CardEditorView / CardDetailView
  ActivityView / SettingsView
    MeyeViewModel (@MainActor, ObservableObject)
      CardRepository protocol
        JSONCardRepository actor
          Application Support/Meye/cards-v1.json
```

- **Model**: value types (`Codable`, `Equatable`, `Sendable`) with UUID identities.
- **View model**: publishes UI state, filters/sorts the feed, coordinates mutations
  and reports errors. UI state is updated only after a successful write.
- **Repository**: protocol injection plus actor isolation. Writes are atomic and
  serialized; there are no detached background saves racing with new edits.
- **Views**: SwiftUI forms, navigation stacks, sheets, file dialogs and accessible
  system controls. Editors work on a draft rather than changing live state.
- **Parser**: pure Foundation logic with explicit date/calendar input for tests.

## Validation status

The Foundation core compiles and all 10 XCTest cases pass under Swift 6.4 on
Linux (Swift 5 language mode). Swift syntax parsing also passes across the UI
sources, and the Xcode project parses with all source references present.
**The iOS build, SwiftUI rendering and device behavior have not yet been
verified** because Xcode, Apple SDKs and a simulator are unavailable here. Before using this as portfolio proof, run the commands above
and the manual checklist in `QA.md`. Do not describe it as shipped or tested on
an iPhone until you have done that validation.

## Original source grounding

- Main app: https://github.com/r69shabh/meye
  - Snapshot reviewed: `8a74002150d233f3924d8dc8642fe258ca3f0505`
  - `README.md`, `main.js` (parser/card feed/card model/stats), `index.html`,
    `tests/unit/nlp.test.js`.
- Packaged companion: https://github.com/r69shabh/meye-app
  - Snapshot reviewed: `72e497af73f461b90a3b520e8904346ccc08d40a`
  - `README.md` and repository structure.

No backdated history, fake release claims or committed credentials.
