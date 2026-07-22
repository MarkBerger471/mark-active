import ActivityKit
import SwiftUI

// The Live Activity's shape — add this file to BOTH the app target (which starts
// the activity) and the widget extension (which renders it). Its ContentState
// keys must match the `content-state` the server pushes in /api/live-activity/push.
//
// ⚠️ There is an identical copy of this struct in the app target (AppDelegate.swift).
// Keep the two in sync — the STORED properties must match exactly.

struct GlucoseActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var value: Double
        var mmol: Double
        var trend: String
        var epoch: Double            // reading time (ms) → drives the age label
        var iob: Double
        var diaHours: Double
        var lastDose: DoseState?
        var history: [HistItem]

        // Tolerant decode: any missing field falls back to a default instead of
        // failing the whole decode (which would make iOS silently drop the push
        // and leave the banner stuck). Keeps the activity resilient to payload
        // version skew between the app and the server.
        enum CodingKeys: String, CodingKey { case value, mmol, trend, epoch, iob, diaHours, lastDose, history }
        init(from d: Decoder) throws {
            let c = try d.container(keyedBy: CodingKeys.self)
            value = try c.decodeIfPresent(Double.self, forKey: .value) ?? 0
            mmol = try c.decodeIfPresent(Double.self, forKey: .mmol) ?? 0
            trend = try c.decodeIfPresent(String.self, forKey: .trend) ?? "→"
            epoch = try c.decodeIfPresent(Double.self, forKey: .epoch) ?? (Date().timeIntervalSince1970 * 1000)
            iob = try c.decodeIfPresent(Double.self, forKey: .iob) ?? 0
            diaHours = try c.decodeIfPresent(Double.self, forKey: .diaHours) ?? 4
            lastDose = try c.decodeIfPresent(DoseState.self, forKey: .lastDose)
            history = try c.decodeIfPresent([HistItem].self, forKey: .history) ?? []
        }
        init(value: Double, mmol: Double, trend: String, epoch: Double, iob: Double,
             diaHours: Double, lastDose: DoseState?, history: [HistItem]) {
            self.value = value; self.mmol = mmol; self.trend = trend; self.epoch = epoch
            self.iob = iob; self.diaHours = diaHours; self.lastDose = lastDose; self.history = history
        }

        struct DoseState: Codable, Hashable {
            var units: Double
            var meal: String
            var carbs: Double?
            var glucoseBefore: Double?
            var timestamp: String
        }
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
        var ageText: String {
            let m = max(0, Int(Date().timeIntervalSince(readingDate) / 60))
            return m == 0 ? "now" : "\(m)m"
        }
        var iobLine: String {
            let base = "IOB \(String(format: "%.1f", iob))u"
            guard iob > 0, let d = lastDose,
                  let ts = ISO8601DateFormatter().date(from: d.timestamp) else { return base }
            let secs = ts.addingTimeInterval(diaHours * 3600).timeIntervalSinceNow
            if secs <= 0 { return base }
            let h = Int(secs) / 3600, m = (Int(secs) % 3600) / 60
            return "\(base) · \(h > 0 ? "\(h)h\(m)m" : "\(m)m") left"
        }
        var mealDetail: String? {
            guard let d = lastDose else { return nil }
            var parts = ["\(Int(d.units))u"]
            if let c = d.carbs, c > 0 { parts.append("\(Int(c))g") }
            var s = "\(d.meal) · \(parts.joined(separator: " · "))"
            if let gl = d.glucoseBefore { s += " @\(Int(gl))" }
            return s
        }
    }
    var name: String = "glucose"
}
