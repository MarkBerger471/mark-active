import { NextResponse } from 'next/server';

const OURA_TOKEN = process.env.OURA_ACCESS_TOKEN;
const OURA_BASE = 'https://api.ouraring.com/v2/usercollection';

export async function GET(request: Request) {
  if (!OURA_TOKEN) {
    return NextResponse.json({ error: 'Oura token not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get('days') || '7');
  const startParam = searchParams.get('start_date');
  const endParam = searchParams.get('end_date');

  const endDate = endParam || new Date().toISOString().split('T')[0];
  const startDate = startParam || new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  const headers = { Authorization: `Bearer ${OURA_TOKEN}` };

  try {
    const [dailyRes, detailRes, readinessRes, activityRes] = await Promise.all([
      fetch(`${OURA_BASE}/daily_sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`${OURA_BASE}/sleep?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`${OURA_BASE}/daily_readiness?start_date=${startDate}&end_date=${endDate}`, { headers }),
      fetch(`${OURA_BASE}/daily_activity?start_date=${startDate}&end_date=${endDate}`, { headers }),
    ]);

    if (!dailyRes.ok || !detailRes.ok) {
      return NextResponse.json({ error: 'Oura API error' }, { status: 502 });
    }

    const daily = await dailyRes.json();
    const detail = await detailRes.json();
    const readiness = readinessRes.ok ? await readinessRes.json() : { data: [] };
    const activity = activityRes.ok ? await activityRes.json() : { data: [] };

    // Build readiness lookup by day
    const readinessMap: Record<string, number> = {};
    for (const r of readiness.data) {
      readinessMap[r.day] = r.score;
    }

    // Build activity lookup by day
    const activityMap: Record<string, { steps: number; activeCalories: number; totalCalories: number }> = {};
    for (const a of activity.data) {
      activityMap[a.day] = {
        steps: a.steps || 0,
        activeCalories: a.active_calories || 0,
        totalCalories: a.total_calories || 0,
      };
    }

    // Combine daily scores with detailed sleep data
    const sleepData = daily.data.map((d: { day: string; score: number; contributors: Record<string, number> }) => {
      const details = detail.data
        .filter((s: { day: string; type: string }) => s.day === d.day && s.type === 'long_sleep')
        .sort((a: { total_sleep_duration: number }, b: { total_sleep_duration: number }) => b.total_sleep_duration - a.total_sleep_duration)[0];

      return {
        day: d.day,
        score: d.score,
        contributors: d.contributors,
        totalSleep: details?.total_sleep_duration,
        deepSleep: details?.deep_sleep_duration,
        remSleep: details?.rem_sleep_duration,
        lightSleep: details?.light_sleep_duration,
        awakeTime: details?.awake_time,
        efficiency: details?.efficiency,
        avgHr: details?.average_heart_rate,
        avgHrv: details?.average_hrv,
        lowestHr: details?.lowest_heart_rate,
        avgBreath: details?.average_breath,
        bedtimeStart: details?.bedtime_start,
        bedtimeEnd: details?.bedtime_end,
        readinessScore: readinessMap[d.day] ?? null,
        steps: activityMap[d.day]?.steps ?? null,
        activeCalories: activityMap[d.day]?.activeCalories ?? null,
        totalCalories: activityMap[d.day]?.totalCalories ?? null,
      };
    });

    // Also return activity-only days not in sleep data
    const sleepDays = new Set(sleepData.map((d: { day: string }) => d.day));
    const activityOnly = Object.entries(activityMap)
      .filter(([day]) => !sleepDays.has(day))
      .map(([day, a]) => ({ day, steps: a.steps, activeCalories: a.activeCalories, totalCalories: a.totalCalories }));

    return NextResponse.json({ data: sleepData, activity: activityOnly });
  } catch (e) {
    console.error('Oura API error:', e);
    return NextResponse.json({ error: 'Failed to fetch sleep data' }, { status: 500 });
  }
}
