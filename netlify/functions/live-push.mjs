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

// Every minute — matches the sensor's publish cadence. Anything slower was the
// dominant source of staleness in the Live Activity (a 5-min cron meant the
// Dynamic Island could trail the sensor by 5 min even when our data was fresh).
export const config = { schedule: '* * * * *' };
