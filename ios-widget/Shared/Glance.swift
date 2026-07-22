import Foundation
import SwiftUI

// Shared data layer for the glucose widget + Live Activity.
// Add this file to BOTH the widget extension target and (Stage B) the app target.

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

// MARK: - API response models

private struct GlucoseCurrent: Codable {
    let value: Double; let valueMmol: Double; let trend: String; let epoch: Double
}
private struct GlucoseHistoryPoint: Codable { let value: Double; let epoch: Double }
private struct GlucoseResponse: Codable { let current: GlucoseCurrent?; let history: [GlucoseHistoryPoint] }
private struct LastDoseAPI: Codable { let units: Double; let meal: String; let carbs: Double?; let glucoseBefore: Double?; let timestamp: String }
private struct InsulinResponse: Codable { let iob: Double; let lastDose: LastDoseAPI?; let diaHours: Double? }

// MARK: - Merged snapshot

struct Glance: Codable, Hashable {
    var value: Double
    var mmol: Double
    var trend: String
    var readingDate: Date
    var iob: Double
    var diaHours: Double
    var lastDoseUnits: Double?
    var lastDoseCarbs: Double?
    var lastDoseGlucose: Double?
    var lastDoseMeal: String?
    var lastDoseDate: Date?
    var history: [HistPoint]

    struct HistPoint: Codable, Hashable, Identifiable {
        var value: Double; var date: Date
        var id: Double { date.timeIntervalSince1970 }
    }

    // Same thresholds as the app.
    var color: Color {
        if value < 80 { return .red }
        if value <= 120 { return .green }
        if value <= 160 { return .orange }
        return .red
    }

    // Age in whole MINUTES (no seconds), for the label.
    var minutesOld: Int { max(0, Int(Date().timeIntervalSince(readingDate) / 60)) }
    var ageText: String { minutesOld == 0 ? "now" : "\(minutesOld)m" }
    var isStale: Bool { minutesOld > 12 }

    // When active insulin runs out = last dose time + DIA.
    var iobEndsAt: Date? {
        guard iob > 0, let d = lastDoseDate else { return nil }
        return d.addingTimeInterval(diaHours * 3600)
    }
    // "2h10m" of IOB remaining, or "" when none.
    var iobLeftText: String {
        guard let end = iobEndsAt else { return "" }
        let secs = end.timeIntervalSinceNow
        if secs <= 0 { return "" }
        let h = Int(secs) / 3600, m = (Int(secs) % 3600) / 60
        return h > 0 ? "\(h)h\(m)m" : "\(m)m"
    }
    // "IOB 2.5u · 2h10m left"
    var iobLine: String {
        let base = "IOB \(String(format: "%.1f", iob))u"
        return iobLeftText.isEmpty ? base : "\(base) · \(iobLeftText) left"
    }
    // "8u · 54g @97"  (units · carbs · glucose at the time of the injection)
    var lastDoseDetail: String {
        var parts: [String] = []
        if let u = lastDoseUnits { parts.append("\(Int(u))u") }
        if let c = lastDoseCarbs, c > 0 { parts.append("\(Int(c))g") }
        var s = parts.joined(separator: " · ")
        if let gl = lastDoseGlucose { s += " @\(Int(gl))" }
        return s
    }

    static let placeholder = Glance(
        value: 112, mmol: 6.2, trend: "→", readingDate: Date(), iob: 2.4, diaHours: 4,
        lastDoseUnits: 8, lastDoseCarbs: 54, lastDoseMeal: "Lunch 15:00",
        lastDoseDate: Date().addingTimeInterval(-3600),
        history: (0..<24).map { i in .init(value: 100 + Double((i * 11) % 60) - 25,
                                            date: Date().addingTimeInterval(Double(i - 24) * 900)) })
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
            diaHours: insulin?.diaHours ?? 4,
            lastDoseUnits: insulin?.lastDose?.units,
            lastDoseCarbs: insulin?.lastDose?.carbs,
            lastDoseGlucose: insulin?.lastDose?.glucoseBefore,
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
