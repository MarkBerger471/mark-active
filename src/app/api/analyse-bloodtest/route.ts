import { NextResponse } from 'next/server';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(request: Request) {
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'API key not configured' }, { status: 500 });
  }

  const { values, lifestyle, previousTests } = await request.json();

  // Format current test values
  const markersTable = values.map((v: { name: string; value: number; unit: string; refMin?: number; refMax?: number; flag?: string; textValue?: string }) => {
    const ref = v.refMin != null && v.refMax != null ? `${v.refMin}–${v.refMax}` : v.refMax != null ? `<${v.refMax}` : v.refMin != null ? `>${v.refMin}` : '—';
    const status = v.flag === 'H' ? 'HIGH' : v.flag === 'L' ? 'LOW' : 'Normal';
    return `${v.name}: ${v.textValue || v.value} ${v.unit} (ref: ${ref}) [${status}]`;
  }).join('\n');

  // Format previous tests for trend
  let trendsSection = '';
  if (previousTests && previousTests.length > 0) {
    trendsSection = '\n\n## Previous Test Results (for trend analysis)\n';
    for (const prev of previousTests) {
      trendsSection += `\n### ${prev.date}${prev.label ? ' — ' + prev.label : ''}\n`;
      for (const v of prev.values) {
        const status = v.flag === 'H' ? ' [HIGH]' : v.flag === 'L' ? ' [LOW]' : '';
        trendsSection += `${v.name}: ${v.textValue || v.value} ${v.unit}${status}\n`;
      }
    }
  }

  // Format lifestyle
  const ls = lifestyle || {};
  const lifestyleSection = `
## Patient Lifestyle Profile (for the period between tests)
- Training: ${ls.trainingFrequency || 'Unknown'} sessions/week (${ls.trainingType || 'resistance training'})
- Body weight: ${ls.weight || 'Unknown'} kg
- Protein intake: ${ls.proteinIntake || 'Unknown'}
- Supplements: ${ls.supplements || 'None reported'}
- TRT: ${ls.trt || 'Unknown'}
- Alcohol: ${ls.alcohol || 'Unknown'}
- Processed food: ${ls.processedFood || 'Unknown'}
- Water: ${ls.water || 'Unknown'}
- Coffee: ${ls.coffee || 'Unknown'}
- Sleep: ${ls.sleep || 'Unknown'}
- Stress: ${ls.stress || 'Unknown'}
`;

  const prompt = `You are a clinical laboratory analyst creating a comprehensive blood test report for a health-conscious male adult who does heavy resistance training.

## Current Blood Test Results
${markersTable}
${lifestyleSection}
${trendsSection}

Generate a complete, professional laboratory analysis report as a standalone HTML document with inline CSS. The report must include:

1. **Patient Profile** — summarise the lifestyle data provided
2. **Flagged Values at a Glance** — summary cards for any out-of-range values showing the value, unit, and reference range
3. **Results by Category** — group markers into categories (Hematology, Clinical Chemistry, Hormones, etc.) with tables showing Test, Result, Unit, Reference, Status. Color-code: green for normal, red for high, blue for low.
4. **Personalised Analysis** — for EACH flagged marker, explain:
   - Why it may be elevated/low given this patient's specific lifestyle (training, diet, TRT, supplements)
   - Whether it is likely benign (e.g., CPK from training) or needs attention
   - Specific actionable recommendations tailored to their profile
5. **Trend Analysis** — if previous test data is provided, compare values and note improvements or deteriorations
6. **Action Plan** — prioritised table of recommended actions with expected impact
7. **What You're Doing Right** — acknowledge positive lifestyle factors

Style the HTML with a clean, modern medical report look:
- Light background (#f0f2f5), dark text (#1a1a2e)
- White cards with subtle shadows, rounded corners (12px)
- Tables with zebra striping and hover effects
- Use green (#27ae60) for normal, red (#c0392b) for high, blue (#2980b9) for low
- Highlight boxes: green for good news, yellow for context/caution, red for warnings
- Font: system-ui, clean and readable
- Mobile-responsive

Do NOT include any <html>, <head>, <body>, or <DOCTYPE> tags. Just output the inner content starting from a container div. Do not include any disclaimers or "this is not medical advice" text. Be thorough, evidence-based, and specific to this patient's profile.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Claude API error:', err);
      return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 502 });
    }

    const data = await response.json();
    const html = data.content?.[0]?.text || '';
    return NextResponse.json({ html });
  } catch (e) {
    console.error('Analyse blood test error:', e);
    return NextResponse.json({ error: 'Failed to generate analysis' }, { status: 500 });
  }
}
