import { NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(request: Request) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  const { food: rawFood } = await request.json();
  if (!rawFood || typeof rawFood !== 'string') {
    return NextResponse.json({ error: 'Missing food name' }, { status: 400 });
  }
  const food = rawFood.slice(0, 100).replace(/[\x00-\x1F"'`\\]/g, '').trim();
  if (!food) {
    return NextResponse.json({ error: 'Invalid food name' }, { status: 400 });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Give me the nutrition data for "${food}" per 100g (cooked/prepared if applicable). Return ONLY a JSON object, no other text:
{
  "name": "lowercase canonical name",
  "kcal": number,
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams),
  "eaa": {
    "leu": number (mg per gram of protein),
    "ile": number (mg per gram of protein),
    "val": number (mg per gram of protein),
    "lys": number (mg per gram of protein),
    "phe": number (mg per gram of protein),
    "thr": number (mg per gram of protein),
    "met": number (mg per gram of protein),
    "trp": number (mg per gram of protein),
    "his": number (mg per gram of protein)
  }
}
Use USDA FoodData Central values. If exact data unavailable, use best scientific estimate.`,
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Anthropic API error:', res.status, err);
      return NextResponse.json({ error: `API ${res.status}: ${err.slice(0, 200)}` }, { status: 502 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse response' }, { status: 500 });
    }

    const result = JSON.parse(jsonMatch[0]);

    // Validate — at minimum need kcal. Protein/EAA can be 0 for non-protein foods
    if (result.kcal === undefined && result.protein === undefined) {
      return NextResponse.json({ error: 'Incomplete data' }, { status: 500 });
    }
    // Default missing EAA to zeros
    if (!result.eaa) {
      result.eaa = { leu: 0, ile: 0, val: 0, lys: 0, phe: 0, thr: 0, met: 0, trp: 0, his: 0 };
    }

    return NextResponse.json(result);
  } catch (e) {
    console.error('Food lookup error:', e);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
}
