import { NextResponse } from 'next/server';

const GOOGLE_API_KEY = process.env.GOOGLE_VISION_API_KEY;

export async function POST(request: Request) {
  if (!GOOGLE_API_KEY) {
    return NextResponse.json({ error: 'Google Vision API key not configured' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    // Determine MIME type
    const mimeType = file.type || 'application/pdf';

    // For PDFs, use DOCUMENT_TEXT_DETECTION which handles multi-page
    // For images, use TEXT_DETECTION
    const isPdf = mimeType === 'application/pdf';

    if (isPdf) {
      // Use files:annotate for PDF (supports up to 5 pages inline)
      const response = await fetch(
        `https://vision.googleapis.com/v1/files:annotate?key=${GOOGLE_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              inputConfig: {
                content: base64,
                mimeType: 'application/pdf',
              },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              pages: [1, 2, 3, 4, 5],
            }],
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        console.error('Google Vision API error:', err);
        return NextResponse.json({ error: 'Google Vision API error' }, { status: 502 });
      }

      const data = await response.json();
      const pages = data.responses?.[0]?.responses || [];
      const text = pages
        .map((p: { fullTextAnnotation?: { text: string } }) => p.fullTextAnnotation?.text || '')
        .join('\n\n');

      return NextResponse.json({ text });
    } else {
      // Image: use images:annotate
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

      if (!response.ok) {
        const err = await response.text();
        console.error('Google Vision API error:', err);
        return NextResponse.json({ error: 'Google Vision API error' }, { status: 502 });
      }

      const data = await response.json();
      const text = data.responses?.[0]?.fullTextAnnotation?.text || '';
      return NextResponse.json({ text });
    }
  } catch (e) {
    console.error('OCR error:', e);
    return NextResponse.json({ error: 'OCR processing failed' }, { status: 500 });
  }
}
