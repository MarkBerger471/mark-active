import Foundation

// Shared on-device cache (App Group) so the app + all widgets read the SAME
// latest glucose/insulin instead of each fetching independently and drifting.
// Whoever fetches newest writes here; everyone else reads it.
//
// Requires the "App Groups" capability (group.com.markberger.markactive) on
// BOTH the app and widget targets. Without it, UserDefaults(suiteName:) is nil
// and this quietly no-ops (each surface just falls back to its own network fetch).
enum SharedStore {
    static let suiteName = "group.com.markberger.markactive"
    private static let gKey = "glucoseJSON"
    private static let iKey = "insulinJSON"
    private static let tKey = "cachedAt"

    static func write(glucose: Data?, insulin: Data?) {
        guard let d = UserDefaults(suiteName: suiteName) else { return }
        if let g = glucose { d.set(g, forKey: gKey) }
        if let i = insulin { d.set(i, forKey: iKey) }
        d.set(Date().timeIntervalSince1970, forKey: tKey)
    }

    /// Cached payloads + their age in seconds, or nil if nothing cached yet.
    static func read() -> (glucose: Data?, insulin: Data?, age: TimeInterval)? {
        guard let d = UserDefaults(suiteName: suiteName) else { return nil }
        let t = d.double(forKey: tKey)
        guard t > 0 else { return nil }
        return (d.data(forKey: gKey), d.data(forKey: iKey), Date().timeIntervalSince1970 - t)
    }
}
