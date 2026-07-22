// Optional shared-secret guard for the widget/live-activity endpoints (they
// expose glucose/insulin data). Set WIDGET_KEY in the environment and the
// widget/push must pass `?key=...`. If WIDGET_KEY is unset the endpoints stay
// open (matches the existing /api/glucose pattern) so nothing breaks until you
// opt in.
export function checkWidgetKey(req: Request): boolean {
  const required = process.env.WIDGET_KEY;
  if (!required) return true;
  try {
    return new URL(req.url).searchParams.get('key') === required;
  } catch {
    return false;
  }
}
