import { NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(request: Request) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  const body = await request.json();
  const { marker: rawMarker, value, unit: rawUnit, refMin, refMax, flag, mode } = body;
  // Sanitize string inputs to prevent prompt injection
  if (!rawMarker || typeof rawMarker !== 'string') {
    return NextResponse.json({ error: 'Missing marker' }, { status: 400 });
  }
  const marker = rawMarker.slice(0, 80).replace(/[\x00-\x1F"'`\\]/g, '').trim();
  const unit = (typeof rawUnit === 'string' ? rawUnit : '').slice(0, 20).replace(/[\x00-\x1F"'`\\]/g, '').trim();
  if (!marker) {
    return NextResponse.json({ error: 'Invalid marker' }, { status: 400 });
  }
  // mode: 'explain' (what is this marker) or 'diagnose' (why is it out of range)

  let prompt = '';

  if (mode === 'explain') {
    prompt = `Explain the blood test marker "${marker}" in a clear, detailed way for a health-conscious adult who is into bodybuilding and fitness. Include:

1. **What it measures** — what does this marker indicate in the body
2. **Why it matters** — its role in health, fitness, and performance
3. **Normal range** — typical reference ranges and what they mean
4. **What affects it** — diet, exercise, supplements, lifestyle factors that influence this marker
5. **For bodybuilders** — any specific relevance for people who train intensely and track nutrition

Keep it informative but accessible. Use short paragraphs. No disclaimers needed.`;
  } else if (mode === 'diagnose') {
    const direction = flag === 'H' || (refMax != null && value > refMax) ? 'HIGH' : 'LOW';
    const rangeStr = refMin != null && refMax != null ? `${refMin}–${refMax}` : refMax != null ? `<${refMax}` : refMin != null ? `>${refMin}` : 'unknown';

    prompt = `The blood test marker "${marker}" has a value of ${value} ${unit}, which is ${direction} (reference range: ${rangeStr} ${unit}).

Provide a detailed, research-based explanation for a health-conscious adult who is into bodybuilding. Include:

1. **What this means** — what does a ${direction.toLowerCase()} ${marker} indicate
2. **Common causes** — list the most common reasons for a ${direction.toLowerCase()} value, ordered by likelihood for an active adult male in his 40s-50s who trains regularly
3. **Bodybuilding-specific causes** — causes specifically related to intense training, high-protein diet, supplement use, or body composition
4. **Potential health implications** — what risks or conditions are associated if left unchecked
5. **What to do** — practical steps to investigate or address this (dietary changes, further tests, lifestyle adjustments)
6. **When to see a doctor** — red flags that warrant medical attention

Be thorough and evidence-based. Use short paragraphs with clear headers. No disclaimers needed.`;
  } else {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return NextResponse.json({ error: 'Failed to generate explanation' }, { status: 502 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return NextResponse.json({ explanation: text });
  } catch (e) {
    console.error('Explain marker error:', e);
    return NextResponse.json({ error: 'Failed to generate explanation' }, { status: 500 });
  }
}
