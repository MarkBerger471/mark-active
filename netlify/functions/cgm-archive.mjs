// Netlify Scheduled Function — CGM archiver.
// Every 15 min it calls /api/cgm-archive, which pulls LibreLinkUp's rolling
// ~12h window and merges it into Firestore day buckets (cgm/{date}). The window
// overlaps each run ~48×, so a skipped run never leaves a gap. Append/dedup only
// — never recomputes — so repeated runs are safe. Self-contained; no 3rd-party cron.

export default async () => {
  try {
    const key = process.env.WIDGET_KEY ? `?key=${process.env.WIDGET_KEY}` : '';
    const url = `${process.env.URL || 'https://mark-active.netlify.app'}/api/cgm-archive${key}`;
    const res = await fetch(url);
    const body = await res.text();
    return new Response(`cgm-archive ${res.status}: ${body}`.slice(0, 300));
  } catch (e) {
    return new Response(`cgm-archive error: ${e}`, { status: 500 });
  }
};

// Every 15 minutes.
export const config = { schedule: '*/15 * * * *' };
