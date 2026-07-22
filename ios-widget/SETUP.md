# Lock/Home‑screen glucose + insulin widget — setup

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

## Stage B — Live Activity (lock screen + Dynamic Island, truly live)

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
