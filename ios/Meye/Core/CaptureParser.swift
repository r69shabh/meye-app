import Foundation

/// Deliberately limited, deterministic capture. The editor is the review step;
/// no phrase is silently sent to a service or scheduled as a notification.
public struct CaptureParser {
    public init() {}
    public func parse(_ raw: String, kind explicitKind: CardKind? = nil,
                      day: Date = Date(), calendar: Calendar = .current) -> MeyeCard {
        let lower = raw.lowercased()
        let daily = lower.range(of: #"\b(every day|daily|routine|habit)\b"#, options: .regularExpression) != nil
        let datePattern = #"\b(day after tomorrow|tomorrow|today|tonight)\b"#
        let dateWord = captures(datePattern, raw).first?.dropFirst().first ?? ""
        let offset = dateWord.lowercased() == "day after tomorrow" ? 2 : (dateWord.lowercased() == "tomorrow" ? 1 : 0)
        let date = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: day)) ?? day
        let timePattern = #"\b(?:at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b"#
        var time: Date?
        if let match = captures(timePattern, lower).first {
            var h = Int(match[1]) ?? -1
            let m = Int(match[2]) ?? 0
            let ap = match[3]
            let valid = m < 60 && m >= 0 && (ap.isEmpty ? (0...23).contains(h) : (1...12).contains(h))
            if valid {
                if ap == "pm" && h < 12 { h += 12 }
                if ap == "am" && h == 12 { h = 0 }
                if ap.isEmpty && (1...8).contains(h) && !lower.contains("wake") && !lower.contains("morning") { h += 12 }
                time = calendar.date(bySettingHour: h, minute: m, second: 0, of: date)
            }
        }
        let inferred: CardKind
        if daily { inferred = .routine }
        else if lower.range(of: #"\b(meeting|appointment|call with|event)\b"#, options: .regularExpression) != nil { inferred = .event }
        else if lower.range(of: #"\b(remind|task|buy|add|need to|remember to)\b"#, options: .regularExpression) != nil { inferred = .todo }
        else if ["gym", "yoga", "meditate", "workout"].contains(lower.trimmingCharacters(in: .whitespacesAndNewlines)) { inferred = .routine }
        else { inferred = time == nil ? .note : .todo }
        let kind = explicitKind ?? inferred
        var title = raw
        title = replacing(#"^(?:um\s+|so\s+|like\s+)+"#, in: title).trimmingCharacters(in: .whitespacesAndNewlines)
        title = replacing(#"^(?:remind me to|remember to|note to self|note:)\s*"#, in: title)
        title = replacing(datePattern, in: title)
        // Invalid times stay in the title, so review does not hide bad input.
        if time != nil { title = replacing(timePattern, in: title) }
        if kind == .routine { title = replacing(#"\b(every day|daily)\b"#, in: title) }
        let tags = captures(#"#([\p{L}\p{N}_-]+)"#, title).map { $0[1] }
        title = replacing(#"#[\p{L}\p{N}_-]+"#, in: title)
        let routineText = title.components(separatedBy: ":")
        var items: [RoutineItem] = []
        if kind == .routine {
            let list = routineText.count > 1 ? routineText.dropFirst().joined(separator: ":") : title
            let normalized = list.replacingOccurrences(of: #"\s+(?:and|then)\s+"#, with: ",", options: .regularExpression)
            items = normalized.components(separatedBy: CharacterSet(charactersIn: ",\n")).compactMap { text in
                let meta = captures(#"\b\d+\s*[x×]\s*\d+\b"#, text).first?.first ?? ""
                let name = tidy(text.replacingOccurrences(of: meta, with: ""))
                return name.isEmpty ? nil : RoutineItem(title: capitalizedFirst(name), meta: meta)
            }
            title = routineText.first ?? title
        }
        title = tidy(title)
        if title.isEmpty { title = raw.trimmingCharacters(in: .whitespacesAndNewlines) }
        var card = MeyeCard(kind: kind, title: capitalizedFirst(title), date: date)
        card.startTime = time
        if kind == .event, let time { card.endTime = calendar.date(byAdding: .hour, value: 1, to: time) }
        card.tags = tags
        card.items = items
        return card
    }
    private func captures(_ pattern: String, _ text: String) -> [[String]] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return [] }
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { match in
            (0..<match.numberOfRanges).map { i in
                let range = match.range(at: i)
                return range.location == NSNotFound ? "" : ns.substring(with: range)
            }
        }
    }
    private func replacing(_ pattern: String, in text: String) -> String {
        text.replacingOccurrences(of: pattern, with: " ", options: [.regularExpression, .caseInsensitive])
    }
    private func tidy(_ text: String) -> String {
        text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
    }
    private func capitalizedFirst(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }
}
