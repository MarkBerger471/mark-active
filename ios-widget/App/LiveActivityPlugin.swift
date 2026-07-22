import Foundation
import Capacitor
import ActivityKit

// Capacitor plugin (add to the APP target). Lets the web app start the glucose
// Live Activity and register its APNs push token with the server, so the push
// sender can update it in the background.
//
// Register it in the app (see SETUP.md): the web side calls
//   LiveActivity.start()  →  starts the activity + posts its token to /register.

@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin {

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.reject("Live Activities need iOS 16.2+"); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities are disabled in Settings"); return
        }
        Task { await startActivity(call) }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else { call.resolve(); return }
        Task {
            for act in Activity<GlucoseActivityAttributes>.activities {
                await act.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }

    @available(iOS 16.2, *)
    private func startActivity(_ call: CAPPluginCall) async {
        // Replace any existing activity so we only track one token.
        for act in Activity<GlucoseActivityAttributes>.activities {
            await act.end(nil, dismissalPolicy: .immediate)
        }
        let initial = GlucoseActivityAttributes.ContentState(
            value: 0, mmol: 0, trend: "→",
            epoch: Date().timeIntervalSince1970 * 1000, iob: 0, lastDose: nil, history: [])
        do {
            let activity = try Activity.request(
                attributes: GlucoseActivityAttributes(),
                content: .init(state: initial, staleDate: nil),
                pushType: .token)
            call.resolve(["started": true])
            // Stream the push token to the server whenever iOS issues/rotates it.
            Task {
                for await tokenData in activity.pushTokenUpdates {
                    let token = tokenData.map { String(format: "%02x", $0) }.joined()
                    await self.register(token: token)
                }
            }
        } catch {
            call.reject("Failed to start activity: \(error.localizedDescription)")
        }
    }

    private func register(token: String) async {
        var req = URLRequest(url: GlanceConfig.registerURL)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["updateToken": token])
        _ = try? await URLSession.shared.data(for: req)
    }
}
