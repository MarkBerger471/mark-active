// Netlify Scheduled Function — keeps the glucose Live Activity live.
// Every 5 minutes it calls the push endpoint, which fetches the newest glucose
// + insulin summary and pushes an update to the running Live Activity via APNs.
// Self-contained; no third-party cron needed.

export default async () => {
  try {
    const key = process.env.WIDGET_KEY ? `?key=${process.env.WIDGET_KEY}` : '';
    const url = `${process.env.URL || 'https://mark-active.netlify.app'}/api/live-activity/push${key}`;
    const res = await fetch(url);
    const body = await res.text();
    return new Response(`live-push ${res.status}: ${body}`.slice(0, 300));
  } catch (e) {
    return new Response(`live-push error: ${e}`, { status: 500 });
  }
};

// Every 5 minutes.
export const config = { schedule: '*/5 * * * *' };
