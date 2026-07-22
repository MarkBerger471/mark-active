import Foundation
import SwiftUI

// Shared data layer for the glucose widget + Live Activity.
// Add this file to BOTH the widget extension target and (if you build the
// Live Activity) the app target.

enum GlanceConfig {
    // ── EDIT THESE ─────────────────────────────────────────────────────────
    static let baseURL = "https://mark-active.netlify.app"
    static let widgetKey = ""   // set to your WIDGET_KEY env value, or leave ""
    // ───────────────────────────────────────────────────────────────────────
    static var keyQuery: String { widgetKey.isEmpty ? "" : "?key=\(widgetKey)" }
    static var glucoseURL: URL { URL(string: "\(baseURL)/api/glucose")! }
    static var insulinURL: URL { URL(string: "\(baseURL)/api/insulin-summary\(keyQuery)")! }
    static var forcePushURL: URL { URL(string: "\(baseURL)/api/live-activity/push\(keyQuery)")! }
    static var registerURL: URL { URL(string: "\(baseURL)/api/live-activity/register\(keyQuery)")! }
}

// MARK: - API response models (match the JSON from the endpoints)

private struct GlucoseCurrent: Codable {
    let value: Double
    let valueMmol: Double
    let trend: String
    let epoch: Double            // ms since 1970
}
private struct GlucoseHistoryPoint: Codable {
    let value: Double
    let epoch: Double
}
private struct GlucoseResponse: Codable {
    let current: GlucoseCurrent?
    let history: [GlucoseHistoryPoint]
}
private struct LastDoseAPI: Codable { let units: Double; let meal: String; let timestamp: String }
private struct InsulinResponse: Codable { let iob: Double; let lastDose: LastDoseAPI? }

// MARK: - Merged snapshot the UI renders from

struct Glance: Codable, Hashable {
    var value: Double
    var mmol: Double
    var trend: String
    var readingDate: Date          // drives the "age" label
    var iob: Double
    var lastDoseUnits: Double?
    var lastDoseMeal: String?
    var lastDoseDate: Date?
    var history: [HistPoint]       // last 6h

    struct HistPoint: Codable, Hashable, Identifiable {
        var value: Double
        var date: Date
        var id: Double { date.timeIntervalSince1970 }
    }

    // Same thresholds as the app: <80 red · ≤120 green · ≤160 amber · >160 red.
    var color: Color {
        if value < 80 { return .red }
        if value <= 120 { return .green }
        if value <= 160 { return .orange }
        return .red
    }

    // "now" if fresh, else the reading age drives freshness colour.
    var isStale: Bool { Date().timeIntervalSince(readingDate) > 12 * 60 }

    static let placeholder = Glance(
        value: 118, mmol: 6.5, trend: "→", readingDate: Date(), iob: 2.0,
        lastDoseUnits: 6, lastDoseMeal: "Lunch 15:00",
        lastDoseDate: Date().addingTimeInterval(-3600),
        history: (0..<24).map { i in
            .init(value: 110 + Double((i * 7) % 40) - 15,
                  date: Date().addingTimeInterval(Double(i - 24) * 900))
        })
}

// MARK: - Loader

enum GlanceLoader {
    static func fetch() async -> Glance? {
        async let g = fetchGlucose()
        async let i = fetchInsulin()
        let (glucose, insulin) = await (g, i)
        guard let cur = glucose?.current else { return nil }

        let sixHoursAgo = Date().addingTimeInterval(-6 * 3600)
        let hist = (glucose?.history ?? [])
            .map { Glance.HistPoint(value: $0.value, date: Date(timeIntervalSince1970: $0.epoch / 1000)) }
            .filter { $0.date >= sixHoursAgo }

        let iso = ISO8601DateFormatter()
        return Glance(
            value: cur.value, mmol: cur.valueMmol, trend: cur.trend,
            readingDate: Date(timeIntervalSince1970: cur.epoch / 1000),
            iob: insulin?.iob ?? 0,
            lastDoseUnits: insulin?.lastDose?.units,
            lastDoseMeal: insulin?.lastDose?.meal,
            lastDoseDate: insulin?.lastDose.flatMap { iso.date(from: $0.timestamp) },
            history: hist)
    }

    private static func fetchGlucose() async -> GlucoseResponse? {
        do { let (d, _) = try await URLSession.shared.data(from: GlanceConfig.glucoseURL)
             return try JSONDecoder().decode(GlucoseResponse.self, from: d) } catch { return nil }
    }
    private static func fetchInsulin() async -> InsulinResponse? {
        do { let (d, _) = try await URLSession.shared.data(from: GlanceConfig.insulinURL)
             return try JSONDecoder().decode(InsulinResponse.self, from: d) } catch { return nil }
    }
}
