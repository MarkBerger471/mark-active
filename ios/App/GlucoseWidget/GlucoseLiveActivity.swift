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

private struct LiveChart: View {
    let history: [GlucoseActivityAttributes.ContentState.HistItem]
    let tint: Color
    var body: some View {
        Chart(history) { p in
            LineMark(x: .value("t", p.date), y: .value("g", p.v))
                .foregroundStyle(tint).interpolationMethod(.catmullRom)
        }
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
                VStack(alignment: .leading, spacing: 1) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text("\(Int(s.value))").font(.system(size: 34, weight: .heavy, design: .rounded)).foregroundStyle(s.color)
                        Text(s.trend).font(.title3).foregroundStyle(s.color)
                    }
                    (Text(s.readingDate, style: .relative) + Text(" old")).font(.caption2).foregroundStyle(.secondary)
                    if s.iob > 0 { Text("IOB \(s.iob, specifier: "%.1f")u").font(.caption2).foregroundStyle(.secondary) }
                }
                LiveChart(history: s.history, tint: s.color)
                Button(intent: ForcePushIntent()) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain).foregroundStyle(.secondary)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.4))
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
                    if s.iob > 0 { Text("IOB \(s.iob, specifier: "%.1f")u").font(.caption) }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    LiveChart(history: s.history, tint: s.color).frame(height: 40)
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
