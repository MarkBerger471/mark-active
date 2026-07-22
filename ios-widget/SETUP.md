# Lock/Home‑screen glucose + insulin widget — setup

> ✅ **BUILT & LIVE (2026‑07‑22).** Stage A (home/lock widget) and Stage B (live
> Live Activity on lock screen + Dynamic Island) are both working on Mark's
> phone. This doc is the record of how it was wired, for rebuilds.
>
> **The real source of truth is the committed `ios/` Xcode project** (widget
> target + AppDelegate live‑activity start + entitlements). The `ios-widget/`
> folder holds canonical copies for reference. Build/install from here with:
> `cd ios/App && xcodebuild -scheme App -destination 'id=<device>' -allowProvisioningUpdates build`
> then `xcrun devicectl device install app --device <id> <built App.app>`.

Everything code‑side is written. This is the part only your Mac + Apple account
can do. Do it in stages — **Stage A (home widget) needs no Apple push setup**, so
get that working first.

Files in this folder:
- `Shared/Glance.swift` — data models + loader (endpoints). **Edit `GlanceConfig`** (base URL / optional key).
- `Shared/GlucoseActivityAttributes.swift` — the Live Activity's shape (shared by app + widget).
- `GlucoseWidget/GlanceWidget.swift` — home/lock widget + `@main` bundle + Refresh intent.
- `GlucoseWidget/GlucoseLiveActivity.swift` — lock‑screen + Dynamic Island live view.
- `App/LiveActivityPlugin.swift` + `App/LiveActivityPlugin.m` — starts the activity + registers its push token (app target).

The web side is already wired: `LiveActivityStarter` calls the plugin on launch (no‑op until the plugin exists), and the endpoints `/api/glucose`, `/api/insulin-summary`, `/api/live-activity/{register,push}` are live once you deploy.

---

## Stage A — Home‑screen widget (no push, ~15‑min refresh)

1. **Xcode → File → New → Target → Widget Extension.** Name it `GlucoseWidget`.
   - **Uncheck** "Include Live Activity" for now (we add it in Stage B), or leave it — either works.
2. Delete the sample files Xcode created; **drag in** `Shared/Glance.swift` and
   `GlucoseWidget/GlanceWidget.swift` (target = the widget extension).
3. In `GlanceWidget.swift`, temporarily change the `@main` bundle to just:
   ```swift
   @main struct GlanceBundle: WidgetBundle { var body: some Widget { GlucoseWidget() } }
   ```
   (drop `GlucoseLiveActivity()` until Stage B).
4. Edit `GlanceConfig.baseURL` if needed (`https://mark-active.netlify.app`).
5. Select the widget scheme → **▶ Build** to your iPhone. Long‑press the home
   screen → **+** → add the **Glucose** widget (medium = the 6h graph). Add the
   rectangular one to the lock screen too if you want a number there.

✅ You now have glucose + 6h graph + IOB + last dose + age + a refresh button,
refreshing on iOS's budget.

---

## Stage B — Live Activity (DONE — how it was wired)

Instead of a Capacitor plugin, the app starts the Live Activity directly from
**`AppDelegate.applicationDidBecomeActive`** (`ios/App/App/AppDelegate.swift`):
it requests `Activity<GlucoseActivityAttributes>` with `pushType: .token`,
streams the APNs push token, and POSTs it to `/api/live-activity/register`. The
attributes type is duplicated in AppDelegate (app target) and
`GlucoseActivityAttributes.swift` (widget target) — keep the two identical.

What was set up:
- **APNs key** (portal): Key ID `TPGB6TSW8S`, Team ID `3MZSK694Y5`, bundle
  `com.markberger.markactive`, environment Sandbox & Production, Team‑Scoped.
- **Xcode:** widget target auto‑gets `GlucoseLiveActivity.swift` +
  `GlucoseActivityAttributes.swift` (GlucoseWidget is a synchronized folder
  group); app target has the **Push Notifications** capability
  (`App/App.entitlements` → `aps-environment`), and `NSSupportsLiveActivities`
  in Info.plist.
- **Netlify env:** `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_P8` (full .p8;
  reconstructed in code via `normalizePem`), `APP_BUNDLE_ID`, `APNS_ENV`
  (`sandbox` for debug builds → `production` for TestFlight/release).
- **Push sender:** `/api/live-activity/push` — ES256 JWT + HTTP/2 to APNs;
  payload wrapped in `{ aps: { event:'update', 'content-state':… } }`.
- **Cron:** `netlify/functions/live-push.mjs` (`*/5 * * * *`) pings the push
  endpoint so it self‑updates.

Note: iOS ends Live Activities after ~8 h → opening the app restarts it
(AppDelegate). Original plugin‑based sketch (unused) is below for reference.

## (unused) Original plugin approach — Live Activity

### B1. Apple Developer portal (one‑time)
1. **Identifiers → your App ID** (`com.markberger.markactive`): enable **Push
   Notifications** and **App Groups** (create group `group.com.markberger.markactive`).
2. **Keys → +** → enable **Apple Push Notifications service (APNs)** → download the
   **`.p8`** file. Note the **Key ID** and your **Team ID**.

### B2. Xcode
1. Add `GlucoseWidget/GlucoseLiveActivity.swift` and `Shared/GlucoseActivityAttributes.swift`
   to the **widget** target, and add `GlucoseActivityAttributes.swift` + `Shared/Glance.swift`
   to the **app** target too.
2. Restore the full `@main` bundle (widget **+** `GlucoseLiveActivity()`).
3. Add `App/LiveActivityPlugin.swift` + `App/LiveActivityPlugin.m` to the **app** target.
4. **App target → Info.plist:** add `NSSupportsLiveActivities = YES`.
5. **Signing & Capabilities (app target):** add **Push Notifications** + **App Groups** (same group).

### B3. Netlify env vars (the push sender)
Set in Netlify → Site settings → Environment:
- `APNS_KEY_ID` = the .p8 Key ID
- `APNS_TEAM_ID` = your Team ID
- `APNS_P8` = the full contents of the .p8 file (keep the `-----BEGIN…END-----` lines)
- `APP_BUNDLE_ID` = `com.markberger.markactive`
- `APNS_ENV` = `sandbox` for Xcode debug builds, `production` for TestFlight/release
- `WIDGET_KEY` = (optional) a random secret; if set, also put it in `GlanceConfig.widgetKey`

### B4. The 5‑minute cron (what makes it live)
Point any scheduler at the push endpoint every 5 min:
```
GET https://mark-active.netlify.app/api/live-activity/push?key=YOUR_WIDGET_KEY
```
Options: a **Netlify Scheduled Function** (`*/5 * * * *`) that fetches that URL, or a
free external cron (cron‑job.org). It reads the newest glucose and pushes it to the
activity.

### B5. Run it
Build to your phone. On launch the app starts the Live Activity and registers its
token; within a cron cycle you'll see the live number + 6h graph + IOB on the lock
screen and Dynamic Island. The **refresh button** forces an immediate push.

> Note: iOS ends Live Activities after ~8 h — opening the app restarts it (already wired).

---

## Test checklist
- `GET /api/glucose` → has `current.epoch` + `history[].epoch`. ✅ (deployed)
- `GET /api/insulin-summary` → `{ iob, lastDose }`. ✅ (deployed)
- `POST /api/live-activity/register {updateToken}` → `{ok:true}`. ✅
- `GET /api/live-activity/push` → `501` until APNs env is set, then `{sent:true}`.
- Widget shows a ticking age and goes red past ~12 min stale.
