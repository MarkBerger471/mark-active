// Netlify Scheduled Function — morning Oura sync.
// Runs every 30 min across the early-morning window and calls the sync endpoint,
// which caches last night's Oura data and fires a one-per-day "Oura synced" push
// the moment it's available — so the data reaches you without opening any app.
// The endpoint is idempotent (notifies once/day, always refreshes the cache),
// so repeated runs are cheap and safe. Self-contained; no third-party cron.

export default async () => {
  try {
    const key = process.env.WIDGET_KEY ? `?key=${process.env.WIDGET_KEY}` : '';
    const url = `${process.env.URL || 'https://mark-active.netlify.app'}/api/oura-sync${key}`;
    const res = await fetch(url);
    const body = await res.text();
    return new Response(`oura-sync ${res.status}: ${body}`.slice(0, 300));
  } catch (e) {
    return new Response(`oura-sync error: ${e}`, { status: 500 });
  }
};

// Every 30 min, 03:00–11:00 UTC (~05:00–13:00 CEST) — covers a normal wake-up
// window with margin; stops notifying once it's fired for the day.
export const config = { schedule: '*/30 3-11 * * *' };
