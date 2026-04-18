import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  const { name: rawName } = await request.json();
  if (!rawName || typeof rawName !== 'string') {
    return NextResponse.json({ error: 'Missing medication name' }, { status: 400 });
  }
  // Sanitize: limit length, strip control chars and quotes that could enable prompt injection
  const name = rawName.slice(0, 100).replace(/[\x00-\x1F"'`\\]/g, '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Invalid medication name' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `Give me medical information about the medication "${name}". Return ONLY a JSON object, no other text:
{
  "genericName": "generic/chemical name",
  "brandNames": ["common brand names"],
  "category": "drug class (e.g. Statin, SSRI, Beta-blocker)",
  "usedFor": "brief description of what it treats",
  "typicalDosage": "common dosage range",
  "bloodMarkerEffects": [
    { "marker": "marker name (e.g. ALT, AST, LDL, Testosterone)", "effect": "increase/decrease/may affect", "note": "brief explanation" }
  ],
  "commonSideEffects": ["list of 3-5 most common side effects"],
  "notes": "any important note for someone doing regular blood tests while on this medication"
}
Use established medical/pharmaceutical references. Focus especially on which blood test markers this medication is known to affect.`,
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `API ${res.status}: ${err.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse response' }, { status: 500 });
    }

    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch (e) {
    console.error('med-lookup error:', e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
