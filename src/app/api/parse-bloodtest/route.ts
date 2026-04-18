import { NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_VISION_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function ocrWithGoogleVision(base64: string, mimeType: string): Promise<string> {
  if (!GOOGLE_API_KEY) throw new Error('Google Vision API key not configured');

  if (mimeType === 'application/pdf') {
    const response = await fetch(
      `https://vision.googleapis.com/v1/files:annotate?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            inputConfig: { content: base64, mimeType: 'application/pdf' },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            pages: [1, 2, 3, 4, 5],
          }],
        }),
      }
    );
    if (!response.ok) throw new Error('Google Vision API error');
    const data = await response.json();
    const pages = data.responses?.[0]?.responses || [];
    return pages.map((p: { fullTextAnnotation?: { text: string } }) => p.fullTextAnnotation?.text || '').join('\n\n');
  } else {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          }],
        }),
      }
    );
    if (!response.ok) throw new Error('Google Vision API error');
    const data = await response.json();
    return data.responses?.[0]?.fullTextAnnotation?.text || '';
  }
}

async function parseWithClaude(ocrText: string): Promise<unknown[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('Anthropic API key not configured');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Extract all blood test results from this lab report text. The text was extracted via OCR from a PDF, so the formatting may be messy with columns misaligned.

Return ONLY a JSON array of objects, each with these fields:
- "name": the test/marker name (e.g. "Hemoglobin", "WBC", "Cholesterol")
- "value": the numeric result as a number (e.g. 15.4, 5200, 130). For text results like "Adequate" or "Normal", use 0
- "textValue": only for non-numeric results (e.g. "Adequate", "Normal"). Omit for numeric values
- "unit": the unit (e.g. "g/dL", "%", "cells/cu.mm.", "mg/dL")
- "refMin": reference range minimum as a number (omit if not available)
- "refMax": reference range maximum as a number (omit if not available)
- "flag": "H" if marked as high, "L" if marked as low (omit if normal)

Important rules:
- Include ALL test markers from the report, do not skip any
- Match each marker with its correct value, unit, and reference range
- The OCR text may have columns read out of order — use your understanding of medical lab reports to correctly match markers with values
- Common markers: Hemoglobin, Hematocrit, WBC, Neutrophil, Lymphocyte, Monocyte, Eosinophil, Basophil, Platelet Count, RBC Count, MCV, MCH, MCHC, RDW, FBS, HbA1C, Cholesterol, Triglyceride, HDL-Cholesterol, LDL-Cholesterol, BUN, Creatinine, eGFR, AST, ALT, etc.
- Do NOT include patient info, lab name, addresses, methods, or specimen types
- Numbers like "5,200" mean 5200 (comma as thousands separator)
- Numbers like "249,000" mean 249000
- For reference ranges like "<200", set refMin to 0 and refMax to 200
- For reference ranges like ">55", set refMin to 55

Return ONLY the JSON array, no other text.

OCR Text:
${ocrText}`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error('Claude API error:', err);
    throw new Error('Claude API error');
  }

  const data = await response.json();
  const text = data.content?.[0]?.text || '[]';

  // Extract JSON array from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('Failed to parse Claude response as JSON:', text);
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = file.type || 'application/pdf';

    // Step 1: OCR with Google Vision
    const ocrText = await ocrWithGoogleVision(base64, mimeType);
    if (!ocrText || ocrText.length < 10) {
      return NextResponse.json({ error: 'Could not extract text from file' }, { status: 422 });
    }

    // Step 2: Parse with Claude
    const values = await parseWithClaude(ocrText);

    return NextResponse.json({ values, ocrText });
  } catch (e) {
    console.error('Parse blood test error:', e);
    return NextResponse.json({ error: 'Parse failed' }, { status: 500 });
  }
}
