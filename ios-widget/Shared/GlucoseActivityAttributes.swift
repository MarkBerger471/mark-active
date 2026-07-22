import ActivityKit
import SwiftUI

// The Live Activity's shape — add this file to BOTH the app target (which starts
// the activity) and the widget extension (which renders it). Its ContentState
// keys must match the `content-state` the server pushes in /api/live-activity/push.

struct GlucoseActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var value: Double
        var mmol: Double
        var trend: String
        var epoch: Double            // reading time (ms) → drives the age label
        var iob: Double
        var lastDose: DoseState?
        var history: [HistItem]

        struct DoseState: Codable, Hashable { var units: Double; var meal: String; var timestamp: String }
        struct HistItem: Codable, Hashable, Identifiable {
            var v: Double; var t: Double
            var id: Double { t }
            var date: Date { Date(timeIntervalSince1970: t / 1000) }
        }

        var readingDate: Date { Date(timeIntervalSince1970: epoch / 1000) }
        var color: Color {
            if value < 80 { return .red }
            if value <= 120 { return .green }
            if value <= 160 { return .orange }
            return .red
        }
    }
    var name: String = "glucose"
}
