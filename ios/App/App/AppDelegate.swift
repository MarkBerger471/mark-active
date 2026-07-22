import UIKit
import Capacitor
import ActivityKit
import SwiftUI

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Ensure the glucose Live Activity is running (starts it on first launch,
        // keeps the existing one otherwise) and register its push token so the
        // server can update it in the background.
        startGlucoseActivity()
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// MARK: - Glucose Live Activity

extension AppDelegate {
    func startGlucoseActivity() {
        guard #available(iOS 16.2, *) else { return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        // Already running → just re-attach the token observer and keep it.
        if let existing = Activity<GlucoseActivityAttributes>.activities.first {
            observeToken(existing)
            return
        }
        let initial = GlucoseActivityAttributes.ContentState(
            value: 0, mmol: 0, trend: "→",
            epoch: Date().timeIntervalSince1970 * 1000, iob: 0, lastDose: nil, history: [])
        do {
            let activity = try Activity.request(
                attributes: GlucoseActivityAttributes(),
                content: .init(state: initial, staleDate: nil),
                pushType: .token)
            observeToken(activity)
        } catch {
            NSLog("Live Activity start failed: \(error.localizedDescription)")
        }
    }

    @available(iOS 16.2, *)
    private func observeToken(_ activity: Activity<GlucoseActivityAttributes>) {
        Task {
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                await registerToken(token)
            }
        }
    }

    private func registerToken(_ token: String) async {
        guard let url = URL(string: "https://mark-active.netlify.app/api/live-activity/register") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["updateToken": token])
        _ = try? await URLSession.shared.data(for: req)
    }
}

// App-target copy of the Live Activity attributes (the widget target has its own
// copy in GlucoseActivityAttributes.swift). Keep the two IDENTICAL — the shape
// must match the `content-state` the server pushes.
struct GlucoseActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var value: Double
        var mmol: Double
        var trend: String
        var epoch: Double
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
