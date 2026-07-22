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
            epoch: Date().timeIntervalSince1970 * 1000, iob: 0, diaHours: 4, lastDose: nil, history: [])
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
// copy in GlucoseActivityAttributes.swift). Keep the two IDENTICAL — the STORED
// properties must match the `content-state` the server pushes.
struct GlucoseActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var value: Double
        var mmol: Double
        var trend: String
        var epoch: Double
        var iob: Double
        var diaHours: Double
        var lastDose: DoseState?
        var history: [HistItem]

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
    }
    var name: String = "glucose"
}
