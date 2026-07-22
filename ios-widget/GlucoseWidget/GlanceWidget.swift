import WidgetKit
import SwiftUI
import Charts
import AppIntents

// Home + lock-screen WidgetKit widget. Fetches /api/glucose + /api/insulin-summary
// on iOS's refresh budget (~10–20 min) and offers a manual Refresh button (home
// families; on the lock screen a tap opens the app).

// MARK: - Refresh button (iOS 17+ interactive widget)

struct RefreshGlanceIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh glucose"
    func perform() async throws -> some IntentResult {
        WidgetCenter.shared.reloadAllTimelines()   // re-runs the timeline → fresh fetch
        return .result()
    }
}

// MARK: - Timeline

struct GlanceEntry: TimelineEntry { let date: Date; let glance: Glance? }

struct GlanceProvider: TimelineProvider {
    func placeholder(in context: Context) -> GlanceEntry { .init(date: Date(), glance: .placeholder) }

    func getSnapshot(in context: Context, completion: @escaping (GlanceEntry) -> Void) {
        Task { completion(.init(date: Date(), glance: await GlanceLoader.fetch() ?? .placeholder)) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<GlanceEntry>) -> Void) {
        Task {
            let g = await GlanceLoader.fetch()
            let next = Date().addingTimeInterval(10 * 60)   // ask again in ~10 min (iOS budgets it)
            completion(Timeline(entries: [GlanceEntry(date: Date(), glance: g)], policy: .after(next)))
        }
    }
}

// MARK: - Shared pieces

struct AgeLabel: View {
    let date: Date
    let stale: Bool
    var body: some View {
        // Auto-ticking relative time ("3 min") — updates without a widget reload.
        (Text(date, style: .relative) + Text(" old"))
            .font(.caption2)
            .foregroundStyle(stale ? .red : .secondary)
    }
}

struct MiniChart: View {
    let history: [Glance.HistPoint]
    let tint: Color
    var body: some View {
        Chart(history) { p in
            AreaMark(x: .value("t", p.date), y: .value("mg/dL", p.value))
                .foregroundStyle(.linearGradient(colors: [tint.opacity(0.35), .clear],
                                                 startPoint: .top, endPoint: .bottom))
            LineMark(x: .value("t", p.date), y: .value("mg/dL", p.value))
                .foregroundStyle(tint)
                .interpolationMethod(.catmullRom)
        }
        .chartYScale(domain: 40...300)
        .chartYAxis { AxisMarks(values: [80, 160]) { AxisGridLine().foregroundStyle(.secondary.opacity(0.3)) } }
        .chartXAxis(.hidden)
    }
}

// MARK: - Family views

struct GlanceMediumView: View {   // home screen — the main view (6h graph)
    let g: Glance
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text("\(Int(g.value))").font(.system(size: 40, weight: .heavy, design: .rounded))
                        .foregroundStyle(g.color)
                    Text(g.trend).font(.title2).foregroundStyle(g.color)
                }
                AgeLabel(date: g.readingDate, stale: g.isStale)
                Spacer(minLength: 0)
                if g.iob > 0 { Text("IOB \(g.iob, specifier: "%.1f")u").font(.caption).foregroundStyle(.secondary) }
                if let u = g.lastDoseUnits, let d = g.lastDoseDate {
                    Text("last \(Int(u))u · \(d, style: .relative)").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .frame(width: 92, alignment: .leading)

            MiniChart(history: g.history, tint: g.color)

            Button(intent: RefreshGlanceIntent()) { Image(systemName: "arrow.clockwise") }
                .buttonStyle(.plain).foregroundStyle(.secondary)
        }
        .padding(12)
    }
}

struct GlanceSmallView: View {    // home small — number + trend + age + IOB
    let g: Glance
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\(Int(g.value))").font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundStyle(g.color)
                Text(g.trend).font(.title3).foregroundStyle(g.color)
                Spacer()
                Button(intent: RefreshGlanceIntent()) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).foregroundStyle(.secondary).font(.caption)
            }
            AgeLabel(date: g.readingDate, stale: g.isStale)
            MiniChart(history: g.history, tint: g.color).frame(height: 46)
            if g.iob > 0 { Text("IOB \(g.iob, specifier: "%.1f")u").font(.caption2).foregroundStyle(.secondary) }
        }
        .padding(12)
    }
}

struct GlanceLockView: View {     // lock screen (accessoryRectangular) — number + age, tap opens app
    let g: Glance
    var body: some View {
        HStack(spacing: 6) {
            Text("\(Int(g.value))").font(.system(size: 22, weight: .bold, design: .rounded))
            Text(g.trend)
            Spacer()
            Text(g.readingDate, style: .relative).font(.caption2)
        }
        .widgetAccentable()
    }
}

// MARK: - Entry view + widget

struct GlanceWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: GlanceEntry
    var body: some View {
        let g = entry.glance
        Group {
            if let g {
                switch family {
                case .systemMedium: GlanceMediumView(g: g)
                case .accessoryRectangular: GlanceLockView(g: g)
                default: GlanceSmallView(g: g)
                }
            } else {
                VStack { Image(systemName: "drop.slash"); Text("No data").font(.caption) }
                    .foregroundStyle(.secondary)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

struct GlucoseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GlucoseWidget", provider: GlanceProvider()) { entry in
            GlanceWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Glucose")
        .description("Glucose, 6h trend, and IOB.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// Single @main entry for the extension — the home/lock widget + the Live Activity.
@main
struct GlanceBundle: WidgetBundle {
    var body: some Widget {
        GlucoseWidget()
        GlucoseLiveActivity()
    }
}
