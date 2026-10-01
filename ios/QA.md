# Mac validation checklist

Status: 10 core XCTest cases passed on Linux with Swift 6.4 in Swift 5 language
mode. The iOS build and all UI/device checks are pending.

## Build and core tests

- [x] `swift test`: all 10 core tests pass on Linux. Repeat on the Mac.
- [ ] `xcodebuild` simulator build passes without errors.
- [ ] Run on iPhone simulator; test compact width and landscape.
- [ ] Run on iPad simulator; no clipped date strip or editor.
- [ ] Inspect light/dark, largest Dynamic Type, VoiceOver labels.

## Capture and editing

- [ ] Empty launch contains no fabricated cards/statistics.
- [ ] Parse `remind me to call mom tomorrow at 5pm`, review date/time, save.
- [ ] Switch to tomorrow; card appears; detail/edit/back navigation works.
- [ ] Explicit Note overrides auto type; details preserve multiple sentences.
- [ ] Create event, set start/end/location; invalid end-before-start blocks Save.
- [ ] Change a timed card's date; clock time stays the same on the new date.
- [ ] Add/remove routine items and edit sets/reps metadata.
- [ ] Whitespace-only title and blank routine items cannot be saved.
- [ ] Cancel capture/edit; no card mutation occurs.

## Completion, persistence and backup

- [ ] Toggle a task; relaunch and verify completion and card contents persist.
- [ ] Complete a routine item; complete all items; whole card becomes complete.
- [ ] Next day is not checked; previous day's completion remains.
- [ ] Heatmap reflects completions; undo changes counts correctly.
- [ ] Export to Files; import that backup after confirming replacement.
- [ ] Cancel import replacement; current cards remain untouched.
- [ ] Invalid JSON/duplicate IDs/unknown version shows an error without deletion.
- [ ] Delete confirmation cancel does nothing; confirmed delete removes history.
- [ ] Theme persists on relaunch.

## Known limits to explain in an interview

- No live sync, notifications or speech. No UI that pretends these work.
- Captured times are metadata. Parser is a small deterministic subset.
- Data is sandboxed JSON, not Core Data. No backend or analytics collection.
- Actor-backed persistence plus MainActor view model; mutations are transactional.
- v1 backup is distinct from the web app schema, and imports replace, not merge.
