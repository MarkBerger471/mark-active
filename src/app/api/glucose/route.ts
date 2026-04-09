import { NextResponse } from 'next/server';
import { createHash } from 'crypto';

const LIBRE_EMAIL = process.env.LIBRE_EMAIL;
const LIBRE_PASSWORD = process.env.LIBRE_PASSWORD;

// LibreLinkUp EU API endpoints
const API_BASE = 'https://api-eu.libreview.io';
const HEADERS: Record<string, string> = {
  'accept-encoding': 'gzip',
  'cache-control': 'no-cache',
  'connection': 'Keep-Alive',
  'content-type': 'application/json',
  'product': 'llu.android',
  'version': '4.16.0',
};

// Cache in memory
let cachedToken: string | null = null;
let cachedPatientId: string | null = null;
let cachedAccountIdHash: string = '';
let cachedBase: string = API_BASE;
let tokenExpiry = 0;

function authHeaders(token: string): Record<string, string> {
  return { ...HEADERS, 'Authorization': `Bearer ${token}`, 'account-id': cachedAccountIdHash };
}

async function authenticate(): Promise<{ token: string; patientId: string; base: string }> {
  if (cachedToken && cachedPatientId && Date.now() < tokenExpiry) {
    return { token: cachedToken, patientId: cachedPatientId, base: cachedBase };
  }

  // Step 1: Login (may redirect to regional endpoint)
  let base = API_BASE;
  let loginRes = await fetch(`${base}/llu/auth/login`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ email: LIBRE_EMAIL, password: LIBRE_PASSWORD }),
  });
  let loginData = await loginRes.json();

  if (loginData.data?.redirect) {
    base = `https://api-${loginData.data.region}.libreview.io`;
    loginRes = await fetch(`${base}/llu/auth/login`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ email: LIBRE_EMAIL, password: LIBRE_PASSWORD }),
    });
    loginData = await loginRes.json();
  }

  if (!loginData.data?.authTicket?.token) {
    throw new Error(`Login failed: status=${loginData.status}`);
  }

  cachedToken = loginData.data.authTicket.token;
  cachedBase = base;
  tokenExpiry = Date.now() + 2 * 60 * 60 * 1000;

  // Hash the user ID for account-id header
  const userId = loginData.data.user?.id || '';
  cachedAccountIdHash = createHash('sha256').update(userId).digest('hex');

  // Step 2: Get connections
  const connRes = await fetch(`${base}/llu/connections`, {
    headers: authHeaders(cachedToken!),
  });
  const connData = await connRes.json();

  if (Array.isArray(connData.data) && connData.data.length > 0) {
    cachedPatientId = connData.data[0].patientId;
  } else {
    console.error('Connections response:', JSON.stringify(connData));
    throw new Error(`No connections found (status: ${connData.status})`);
  }

  return { token: cachedToken!, patientId: cachedPatientId!, base: cachedBase };
}

// Trend arrow mapping
const TREND_ARROWS: Record<number, string> = {
  1: '↓↓', // falling quickly
  2: '↓',  // falling
  3: '→',  // stable
  4: '↑',  // rising
  5: '↑↑', // rising quickly
};

export async function GET() {
  if (!LIBRE_EMAIL || !LIBRE_PASSWORD) {
    return NextResponse.json({ error: 'Libre credentials not configured' }, { status: 500 });
  }

  try {
    const { token, patientId, base } = await authenticate();

    const graphRes = await fetch(`${base}/llu/connections/${patientId}/graph`, {
      headers: authHeaders(token),
    });

    if (!graphRes.ok) {
      cachedToken = null;
      tokenExpiry = 0;
      const retry = await authenticate();
      const retryRes = await fetch(`${retry.base}/llu/connections/${retry.patientId}/graph`, {
        headers: authHeaders(retry.token),
      });
      if (!retryRes.ok) throw new Error(`Graph fetch failed: ${retryRes.status}`);
      return formatResponse(await retryRes.json());
    }

    return formatResponse(await graphRes.json());
  } catch (e) {
    console.error('Glucose API error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatResponse(graphData: any) {
  const connection = graphData?.data?.connection;
  const glucoseMeasurement = connection?.glucoseMeasurement;
  const graphPoints = graphData?.data?.graphData as Array<Record<string, unknown>> | undefined;

  // Current reading
  const current = glucoseMeasurement ? {
    value: glucoseMeasurement.ValueInMgPerDl as number,
    valueMmol: Math.round((glucoseMeasurement.ValueInMgPerDl as number) * 0.0555 * 10) / 10,
    trend: TREND_ARROWS[(glucoseMeasurement.TrendArrow as number) ?? 3] || '→',
    trendRaw: glucoseMeasurement.TrendArrow as number,
    timestamp: glucoseMeasurement.Timestamp as string,
    isHigh: (glucoseMeasurement.ValueInMgPerDl as number) > 160,
    isLow: (glucoseMeasurement.ValueInMgPerDl as number) < 80,
  } : null;

  // Historical readings (typically last 12-24 hours, every 15 min)
  const history = (graphPoints || []).map((p: Record<string, unknown>) => ({
    value: p.ValueInMgPerDl as number,
    valueMmol: Math.round((p.ValueInMgPerDl as number) * 0.0555 * 10) / 10,
    timestamp: p.Timestamp as string,
  }));

  // Stats
  const values = history.map((h: { value: number }) => h.value).filter((v: number) => v > 0);
  const inRange = values.filter((v: number) => v >= 80 && v <= 110).length;
  const timeInRange = values.length > 0 ? Math.round((inRange / values.length) * 100) : 0;
  const avgGlucose = values.length > 0 ? Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length) : 0;
  const avgMmol = Math.round(avgGlucose * 0.0555 * 10) / 10;
  // Estimated HbA1c = (avgGlucose + 46.7) / 28.7
  const estimatedA1c = values.length > 0 ? Math.round(((avgGlucose + 46.7) / 28.7) * 10) / 10 : 0;

  return NextResponse.json({
    current,
    history,
    stats: { timeInRange, avgGlucose, avgMmol, estimatedA1c, readings: values.length },
  });
}
