import ActivityKit
import WidgetKit
import SwiftUI
import Charts
import AppIntents

// The live glucose view for the lock screen + Dynamic Island. Its ContentState
// (in Shared/GlucoseActivityAttributes.swift) must match the `content-state`
// the server pushes (see /api/live-activity/push).

// Refresh button: asks the server to push the newest reading to this activity.
struct ForcePushIntent: AppIntent {
    static var title: LocalizedStringResource = "Refresh glucose"
    func perform() async throws -> some IntentResult {
        _ = try? await URLSession.shared.data(from: GlanceConfig.forcePushURL)
        return .result()
    }
}

private func liveZone(_ v: Double) -> Color {
    if v < 80 { return .red }
    if v <= 120 { return .green }
    if v <= 160 { return .orange }
    return .red
}

private struct LiveChart: View {
    let history: [GlucoseActivityAttributes.ContentState.HistItem]
    var body: some View {
        Chart {
            RectangleMark(yStart: .value("lo", 80.0), yEnd: .value("hi", 120.0))
                .foregroundStyle(.green.opacity(0.12))
            // per-segment line coloured by glucose zone (matches the app)
            ForEach(Array(history.enumerated()), id: \.offset) { idx, p in
                if idx > 0 {
                    let prev = history[idx - 1]
                    let c = liveZone((prev.v + p.v) / 2)
                    LineMark(x: .value("t", prev.date), y: .value("g", prev.v), series: .value("s", idx))
                        .foregroundStyle(c).lineStyle(.init(lineWidth: 2.2, lineCap: .round))
                    LineMark(x: .value("t", p.date), y: .value("g", p.v), series: .value("s", idx))
                        .foregroundStyle(c).lineStyle(.init(lineWidth: 2.2, lineCap: .round))
                }
            }
            if let last = history.last {
                PointMark(x: .value("t", last.date), y: .value("g", last.v))
                    .foregroundStyle(liveZone(last.v)).symbolSize(55)
                PointMark(x: .value("t", last.date), y: .value("g", last.v))
                    .foregroundStyle(.white).symbolSize(12)
            }
        }
        .chartLegend(.hidden)
        .chartYScale(domain: 40...300)
        .chartXAxis(.hidden).chartYAxis(.hidden)
    }
}

struct GlucoseLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GlucoseActivityAttributes.self) { context in
            // Lock-screen banner
            let s = context.state
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 5) {
                        Text("\(Int(s.value))")
                            .font(.system(size: 42, weight: .black, design: .rounded))
                            .foregroundStyle(s.color).shadow(color: s.color.opacity(0.5), radius: 6)
                        Text(s.trend).font(.title2.weight(.bold)).foregroundStyle(s.color)
                        Text(s.ageText).font(.caption).foregroundStyle(.secondary).padding(.leading, 1)
                    }
                    if s.iob > 0 { Text(s.iobLine).font(.caption2.weight(.medium)).foregroundStyle(.cyan) }
                    if let md = s.mealDetail { Text(md).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 4)
                LiveChart(history: s.history).frame(width: 132)
                Button(intent: ForcePushIntent()) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).foregroundStyle(.secondary)
            }
            .padding(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 14))
            .activityBackgroundTint(Color.black.opacity(0.55))
        } dynamicIsland: { context in
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 3) {
                        Text("\(Int(s.value))").font(.title2).bold().foregroundStyle(s.color)
                        Text(s.trend).foregroundStyle(s.color)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(s.ageText).font(.caption2).foregroundStyle(.secondary)
                        if s.iob > 0 { Text("IOB \(s.iob, specifier: "%.1f")u").font(.caption2).foregroundStyle(.cyan) }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    LiveChart(history: s.history).frame(height: 42)
                }
            } compactLeading: {
                Text("\(Int(s.value))").bold().foregroundStyle(s.color)
            } compactTrailing: {
                Text(s.trend).foregroundStyle(s.color)
            } minimal: {
                Text("\(Int(s.value))").font(.caption2).bold().foregroundStyle(s.color)
            }
        }
    }
}
