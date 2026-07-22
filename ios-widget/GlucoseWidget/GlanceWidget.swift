import WidgetKit
import SwiftUI
import Charts
import AppIntents

// Home + lock-screen widget. Premium dark-glass look: glossy sheen, glowing
// value, frosted chips, scaled 6h graph with a live end dot, IOB time-left,
// last-meal carbs + glucose-at-injection, minute-only age.

// MARK: - Refresh button (iOS 17+)

struct RefreshGlanceIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh glucose"
    func perform() async throws -> some IntentResult {
        WidgetCenter.shared.reloadAllTimelines()
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
            completion(Timeline(entries: [GlanceEntry(date: Date(), glance: g)],
                                policy: .after(Date().addingTimeInterval(10 * 60))))
        }
    }
}

// MARK: - Premium glass background

struct GlassBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.05, green: 0.05, blue: 0.10),
                                    Color(red: 0.06, green: 0.09, blue: 0.17),
                                    Color(red: 0.04, green: 0.05, blue: 0.11)],
                           startPoint: .top, endPoint: .bottom)
            // glossy highlight, top-left
            RadialGradient(colors: [Color.white.opacity(0.10), .clear],
                           center: .topLeading, startRadius: 4, endRadius: 200)
            // faint colour wash, bottom-right
            RadialGradient(colors: [Color.cyan.opacity(0.06), .clear],
                           center: .bottomTrailing, startRadius: 4, endRadius: 220)
        }
    }
}

// Small frosted chip
struct Chip<Content: View>: View {
    var tint: Color = .white
    @ViewBuilder var content: Content
    var body: some View {
        content
            .font(.system(size: 10, weight: .semibold))
            .padding(.horizontal, 6).padding(.vertical, 2.5)
            .background(Capsule().fill(tint.opacity(0.14)))
            .overlay(Capsule().stroke(tint.opacity(0.22), lineWidth: 0.5))
            .foregroundStyle(tint.opacity(0.95))
    }
}

// MARK: - Scaled 6h chart

// Colour a glucose value by zone (same thresholds as the app).
func glucoseZone(_ v: Double) -> Color {
    if v < 80 { return .red }
    if v <= 120 { return .green }
    if v <= 160 { return .orange }
    return .red
}

struct ScaledChart: View {
    let history: [Glance.HistPoint]
    let tint: Color
    var body: some View {
        Chart {
            RectangleMark(yStart: .value("lo", 80.0), yEnd: .value("hi", 120.0))
                .foregroundStyle(.green.opacity(0.10))
            // subtle single area fill for depth
            ForEach(history) { p in
                AreaMark(x: .value("t", p.date), y: .value("g", p.value))
                    .foregroundStyle(.linearGradient(colors: [tint.opacity(0.16), .clear],
                                                     startPoint: .top, endPoint: .bottom))
                    .interpolationMethod(.catmullRom)
            }
            // line drawn as per-segment pieces, each coloured by its zone
            ForEach(Array(history.enumerated()), id: \.offset) { idx, p in
                if idx > 0 {
                    let prev = history[idx - 1]
                    let c = glucoseZone((prev.value + p.value) / 2)
                    LineMark(x: .value("t", prev.date), y: .value("g", prev.value), series: .value("s", idx))
                        .foregroundStyle(c).lineStyle(.init(lineWidth: 2, lineCap: .round))
                    LineMark(x: .value("t", p.date), y: .value("g", p.value), series: .value("s", idx))
                        .foregroundStyle(c).lineStyle(.init(lineWidth: 2, lineCap: .round))
                }
            }
        }
        .chartLegend(.hidden)
        .chartYScale(domain: 40.0...280.0)
        .chartYAxis {
            AxisMarks(position: .trailing, values: [80.0, 160.0, 240.0]) {
                AxisGridLine().foregroundStyle(.white.opacity(0.12))
                AxisValueLabel().foregroundStyle(.white.opacity(0.5)).font(.system(size: 9, weight: .medium))
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: .hour, count: 1)) {
                AxisGridLine().foregroundStyle(.white.opacity(0.06))
                AxisValueLabel(format: .dateTime.hour(), anchor: .top)
                    .foregroundStyle(.white.opacity(0.45)).font(.system(size: 9, weight: .medium))
            }
        }
        .chartPlotStyle { $0.padding(.trailing, 2) }
    }
}

// MARK: - Shared pieces

struct ReloadButton: View {
    var body: some View {
        Button(intent: RefreshGlanceIntent()) {
            Image(systemName: "arrow.clockwise").font(.system(size: 10, weight: .bold))
        }
        .buttonStyle(.plain).foregroundStyle(.white.opacity(0.6))
        .padding(5).background(Circle().fill(.white.opacity(0.10)))
    }
}

// Number + trend + age + reload — reload sits right next to the glucose number.
struct HeaderRow: View {
    let g: Glance
    var numberSize: CGFloat = 34
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(Int(g.value))")
                .font(.system(size: numberSize, weight: .black, design: .rounded))
                .foregroundStyle(g.color).shadow(color: g.color.opacity(0.5), radius: 7)
            Text(g.trend).font(.system(size: numberSize * 0.5, weight: .bold)).foregroundStyle(g.color)
            Spacer(minLength: 2)
            Text(g.ageText).font(.system(size: 10, weight: .semibold))
                .foregroundStyle(g.isStale ? .red : .white.opacity(0.5))
            ReloadButton()
        }
    }
}

// MARK: - Family views

struct GlanceMediumView: View {   // wide: info column + tall graph
    let g: Glance
    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HeaderRow(g: g)
                if g.iob > 0 { Chip(tint: .cyan) { Text(g.iobLine) } }
                if let meal = g.lastDoseMeal {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(meal).font(.system(size: 10, weight: .semibold)).foregroundStyle(.white.opacity(0.65)).lineLimit(1)
                        Text(g.lastDoseDetail).font(.system(size: 10)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .frame(width: 116, alignment: .leading)
            ScaledChart(history: g.history, tint: g.color)
        }
        .padding(EdgeInsets(top: 12, leading: 12, bottom: 10, trailing: 12))
    }
}

struct GlanceSmallView: View {   // square: compact header + footer, graph fills the middle
    let g: Glance
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HeaderRow(g: g, numberSize: 30)
            ScaledChart(history: g.history, tint: g.color)
                .frame(maxHeight: .infinity)   // <- graph takes all remaining height
            VStack(alignment: .leading, spacing: 1) {
                if g.iob > 0 {
                    Text(g.iobLine).font(.system(size: 9, weight: .medium)).foregroundStyle(.cyan.opacity(0.85)).lineLimit(1)
                }
                if let meal = g.lastDoseMeal {
                    Text("\(meal) · \(g.lastDoseDetail)").font(.system(size: 9)).foregroundStyle(.white.opacity(0.5)).lineLimit(1)
                }
            }
            .padding(.leading, 6)
        }
        .padding(EdgeInsets(top: 11, leading: 11, bottom: 9, trailing: 11))
    }
}

struct GlanceLockView: View {   // accessoryRectangular — tap opens app
    let g: Glance
    // Big, centred, glanceable: number + trend on top, IOB + age below.
    // No graph (per request). Monochrome — iOS tints lock-screen widgets.
    var body: some View {
        VStack(spacing: 1) {
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Spacer(minLength: 0)
                Text("\(Int(g.value))").font(.system(size: 36, weight: .bold, design: .rounded))
                Text(g.trend).font(.title2.weight(.semibold))
                Spacer(minLength: 0)
            }
            Text(g.iob > 0 ? "IOB \(String(format: "%.1f", g.iob))u · \(g.ageText)" : g.ageText)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .widgetAccentable()
    }
}

// MARK: - Entry view + widget

struct GlanceWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    var entry: GlanceEntry
    var body: some View {
        Group {
            if let g = entry.glance {
                switch family {
                case .systemMedium: GlanceMediumView(g: g)
                case .accessoryRectangular: GlanceLockView(g: g)
                default: GlanceSmallView(g: g)
                }
            } else {
                VStack(spacing: 2) { Image(systemName: "drop.slash"); Text("No data").font(.caption2) }
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .containerBackground(for: .widget) {
            if family == .accessoryRectangular { Color.clear } else { GlassBackground() }
        }
    }
}

struct GlucoseWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "GlucoseWidget", provider: GlanceProvider()) { entry in
            GlanceWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Glucose")
        .description("Glucose, 6h trend, IOB.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
        .contentMarginsDisabled()
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
