'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { getBloodTests, saveBloodTests, getTrainingSessions, getNutritionPlan, getMeasurements, getSetting, saveSetting } from '@/utils/storage';
import { BloodTest, BloodTestValue, TrainingSession, NutritionPlan } from '@/types';
import EmptyState from '@/components/EmptyState';
import ReactMarkdown from 'react-markdown';

function MarkerPopup({ title, content, loading, onClose }: { title: string; content: string; loading: boolean; onClose: () => void }) {
  // Remove redundant first line if it's just the marker name repeated
  const cleanContent = content.replace(/^#+\s*.+\n+/, '').replace(/^\*\*.+\*\*\n+/, '').replace(/^.+:\s*.+You Need.+\n+/i, '').trim();

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-lg max-h-[80vh] overflow-y-auto glass-strong rounded-t-2xl sm:rounded-2xl p-0 m-0 sm:m-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[#1a1a2e] border-b border-white/10 px-5 py-4 rounded-t-2xl flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-white/40 hover:text-white/80 w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-all text-lg">x</button>
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-white/40 text-sm">Loading explanation...</span>
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none [&_h1]:text-white/90 [&_h1]:text-base [&_h1]:mt-3 [&_h2]:text-white/90 [&_h2]:text-sm [&_h2]:mt-4 [&_h2]:mb-1 [&_h3]:text-white/80 [&_h3]:text-xs [&_h3]:mt-3 [&_h3]:mb-1 [&_strong]:text-white/80 [&_li]:text-white/55 [&_li]:text-sm [&_p]:text-white/55 [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:my-1 [&_ol]:my-1">
              <ReactMarkdown>{cleanContent}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Words/patterns that indicate junk lines (not blood test values)
const JUNK_PATTERNS = [
  /^(page|date|name|address|phone|fax|email|doctor|dr\.|patient|report|laboratory|lab|hospital|clinic|specimen|collected|printed|result|ref\.?\s*range|pot\s*name|age|sex|cell|road|tel|hn)/i,
  /@/, // email
  /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/, // date only
  /^\d{5,}$/, // long number (phone, ID)
  /^(tel|www|http|us\s*tel|mr\.|mrs\.|ms\.)/i,
  /^\W+$/, // only symbols
  /MB\d+/, // lab IDs
  /charansan|bangkok|road/i, // addresses
];

function cleanMarkerName(name: string): string {
  return name.replace(/^[\s*•·\-]+/, '').replace(/[\s*•·\-]+$/, '').trim();
}

function isJunkLine(name: string): boolean {
  if (name.length < 2 || name.length > 60) return true;
  return JUNK_PATTERNS.some(p => p.test(name));
}

// Known blood test marker names for matching
const KNOWN_MARKERS = new Set([
  'hemoglobin', 'hematocrit', 'wbc', 'neutrophil', 'lymphocyte', 'monocyte',
  'eosinophil', 'basophil', 'platelet count', 'platelet smear', 'rbc count',
  'rbc morphology', 'mcv', 'mch', 'mchc', 'rdw', 'fbs', 'hba1c',
  'cholesterol', 'triglyceride', 'hdl-cholesterol', 'hdl cholesterol',
  'ldl-cholesterol', 'ldl cholesterol', 'bun', 'creatinine', 'creatinine (enzymatic)',
  'egfr ckd-epi', 'egfr', 'cystatin c', 'ast (sgot)', 'alt (sgpt)', 'ast', 'alt',
  'total bilirubin', 'direct bilirubin', 'albumin', 'globulin', 'total protein',
  'sodium', 'potassium', 'chloride', 'co2', 'anion gap', 'phosphorus',
  'magnesium', 'calcium', 'serum iron', 'serum iron (si)', 'uibc', 'tibc',
  'transferrin saturation', 'ferritin', 'total psa', 'psa', 'free psa',
  't3', 't4', 'free t3', 'free t4', 'tsh', 'estradiol', 'prolactin',
  'testosterone', 'dhea-s', 'cortisol', 'insulin', 'vitamin d', 'vitamin b12',
  'folate', 'uric acid', 'ld', 'ldh', 'ggt', 'alp', 'alkaline phosphatase',
  'iron', 'absolute neutrophil count', 'absolute lymphocyte count',
  'glucose', 'hb', 'rbc', 'plt', 'wbc count', 'mpv',
]);

// Units commonly found in blood tests
const UNIT_PATTERNS = /^[HL]?\s*(g\/dl|g\/dL|mg\/dL|mg\/dl|mg\/L|ng\/mL|ng\/ml|ng\/dL|ng\/dl|ug\/dL|ug\/dl|pg\/ml|pg\/mL|%|cells\/cu\.mm\.|mmol\/L|mL\/min|fl|pg|fL|U\/L|u\/l|IU\/L|mIU\/L|x10\^6|ug\/dL|umol\/L|µg\/dL|µmol\/L)/i;

function parseColumnFormat(text: string): BloodTestValue[] {
  const values: BloodTestValue[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.replace(/^[\s*•·\-=↑]+/, '').trim()).filter(l => l);

  // Find all marker name positions in the text
  const markerPositions: { name: string; lineIdx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 2) continue;
    // Skip Thai, junk, methods, specimens
    if (/[\u0E00-\u0E7F]/.test(line)) continue;
    if (/^(EI|EDTA|Clotted|Enz-|Direct|Calculation|Indirect|BCG|Biuret|DPD|CMA|CMIA|ECLIA|TINIA|Immuno|Phospho|Arsenazo|Cresol|color|NaF|kinetic|blank)/i.test(line)) continue;
    if (/^(Page|REPORTED|APPROVED|PRINT|NOTE|LABORATORY|ACCREDITATION|FM-|Hospital|Collected|Requested|Received|Date|Name:|Age:|HN:|Sex:|Lab|Test$|Result$|Unit$|Reference|Method$|Specimens$|HEMATOLOGY|CLINICAL|IMMUNOLOGY|TUMOR|HORMONE|URINALYSIS|COAGULATION|SEROLOGY|DMSC|xxx|\*\*\*|-Page|Color$)/i.test(line)) continue;
    if (/^[A-Z\s&]{3,}$/.test(line) && !KNOWN_MARKERS.has(line.toLowerCase())) continue;
    if (/blood|serum|plasma|urine|correction|assay|membership|berger|bangko|road|charansan|hotmail|www\./i.test(line)) continue;
    if (/^\d/.test(line)) continue; // starts with digit = not a name
    if (/^[<>]/.test(line)) continue;
    if (line.length > 50) continue;
    if (/^[HL]\s/i.test(line)) continue; // flag+unit line
    if (/^(g\/|mg\/|ng\/|ug\/|pg\/|%|cells|mmol|mL\/|fl$|pg$|U\/L|IU\/)/i.test(line)) continue; // unit line

    // This looks like a marker name
    markerPositions.push({ name: cleanMarkerName(line), lineIdx: i });
  }

  // For each marker, scan forward to find its value
  for (let mi = 0; mi < markerPositions.length; mi++) {
    const marker = markerPositions[mi];
    const nextMarkerLine = mi + 1 < markerPositions.length ? markerPositions[mi + 1].lineIdx : lines.length;

    // Look between this marker's line and the next marker's line for data
    let foundValue = false;
    for (let j = marker.lineIdx + 1; j < nextMarkerLine && j < lines.length; j++) {
      const line = lines[j];

      // Text result? (Adequate, Normal, etc.)
      if (/^(Adequate|Normal|Negative|Positive|Reactive|Non-reactive)/i.test(line)) {
        values.push({ name: marker.name, value: 0, textValue: line, unit: '' });
        foundValue = true;
        break;
      }

      // Numeric value?
      if (/^[\d.,]+$/.test(line)) {
        const val = parseNumber(line);
        if (isNaN(val)) continue;

        const entry: BloodTestValue = { name: marker.name, value: val, unit: '' };

        // Scan remaining lines before next marker for unit, flag, range
        for (let k = j + 1; k < nextMarkerLine && k < lines.length; k++) {
          const dl = lines[k];

          // Flag + unit: "H mg/dL", "L g/dL", "H %", "HUL"
          const flagUnit = dl.match(/^([HL])\s+(.+)/i);
          if (flagUnit) { entry.flag = flagUnit[1].toUpperCase(); entry.unit = flagUnit[2].trim(); continue; }
          if (/^HUL$/i.test(dl)) { entry.flag = 'H'; entry.unit = 'U/L'; continue; }

          // Pure unit
          if (/^(g\/|mg\/|ng\/|ug\/|pg\/|%$|cells|mmol|mL\/|fl$|pg$|U\/L|IU\/|x10)/i.test(dl) && dl.length < 25) {
            entry.unit = dl.trim();
            continue;
          }

          // Range: "12.70-16.90"
          const rangeMatch = dl.match(/^([\d.,]+)\s*[-–]\s*([\d.,]+)/);
          if (rangeMatch) {
            entry.refMin = parseNumber(rangeMatch[1]);
            entry.refMax = parseNumber(rangeMatch[2]);
            continue;
          }

          // Threshold: "<50", ">55", "<200"
          const threshMatch = dl.match(/^<\s*([\d.,]+)/);
          if (threshMatch) { entry.refMin = 0; entry.refMax = parseNumber(threshMatch[1]); continue; }
          const threshMatch2 = dl.match(/^>\s*([\d.,]+)/);
          if (threshMatch2) { entry.refMin = parseNumber(threshMatch2[1]); continue; }
        }

        values.push(entry);
        foundValue = true;
        break;
      }
    }

    // If no value found between markers, skip this marker
    if (!foundValue) continue;
  }

  return values;
}

function parseMultiLineFormat(text: string): BloodTestValue[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).filter(l => l);

  // Step 1: Collect marker names, values, units, and ranges
  const markers: string[] = [];
  const results: { value: number; textValue?: string; flag?: string; unit: string; refMin?: number; refMax?: number }[] = [];

  // Identify marker names: lines that match known markers or look like test names
  const nameLines: { idx: number; name: string }[] = [];
  const dataChunks: { value: number; textValue?: string; flag?: string; unit: string; refMin?: number; refMax?: number }[] = [];

  // Pass 1: Tag each line
  type TaggedLine = { type: 'name' | 'value' | 'flagunit' | 'range' | 'skip'; text: string; idx: number };
  const tagged: TaggedLine[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const clean = line.replace(/^[\s*•·\-=↑]+/, '').trim();
    if (!clean) continue;

    // Skip known junk
    if (isJunkLine(clean)) { tagged.push({ type: 'skip', text: clean, idx: i }); continue; }
    // Skip Thai text
    if (/[\u0E00-\u0E7F]/.test(clean)) { tagged.push({ type: 'skip', text: clean, idx: i }); continue; }
    // Skip method/specimen lines
    if (/^(EI|EDTA|Clotted|Enz-|Direct|Calculation|Indirect|BCG|Biuret|DPD|CMA|CMIA|ECLIA|TINIA|Immuno|Phospho|Arsenazo|Cresol|color)/i.test(clean)) {
      tagged.push({ type: 'skip', text: clean, idx: i });
      continue;
    }
    // Skip section headers, page/report lines
    if (/^(Page|REPORTED|APPROVED|PRINT|NOTE|LABORATORY|ACCREDITATION|FM-|Hospital|Collected|Requested|Received|\*\*\*|xxx|-Page|Test$|Result$|Unit$|Reference|Method$|Specimens$|HEMATOLOGY|CLINICAL CHEMISTRY|IMMUNOLOGY|TUMOR MARKER|HORMONE|URINALYSIS|COAGULATION|SEROLOGY|DMSC|Date$|Date:|Color|Adequate|Normal|Name:|Age:|HN:|Sex:|Lab No)/i.test(clean)) {
      tagged.push({ type: 'skip', text: clean, idx: i });
      continue;
    }
    // Skip single characters or very short
    if (clean.length <= 2 && !/^\d/.test(clean)) { tagged.push({ type: 'skip', text: clean, idx: i }); continue; }

    // Is it a range? (number-number)
    if (/^[<>]?\s*[\d.,]+\s*[-–]\s*[\d.,]+\s*[%]?\s*$/.test(clean)) {
      tagged.push({ type: 'range', text: clean, idx: i });
      continue;
    }
    // Is it a threshold? (<50, >55, <200)
    if (/^[<>]\s*[\d.,]+\s*$/.test(clean)) {
      tagged.push({ type: 'range', text: clean, idx: i });
      continue;
    }

    // Is it a [H|L] + unit line? (e.g., "H mg/dL", "L g/dL", "H %")
    if (/^[HL]\s+\S/i.test(clean) && UNIT_PATTERNS.test(clean)) {
      tagged.push({ type: 'flagunit', text: clean, idx: i });
      continue;
    }
    // Pure unit line
    if (UNIT_PATTERNS.test(clean) && clean.length < 20) {
      tagged.push({ type: 'flagunit', text: clean, idx: i });
      continue;
    }
    // "HUL" = "H U/L" (OCR artifact)
    if (/^HUL$/i.test(clean) || /^H\s*U\s*\/?\s*L$/i.test(clean)) {
      tagged.push({ type: 'flagunit', text: 'H U/L', idx: i });
      continue;
    }

    // Is it a numeric value? (starts with digit, possibly with comma)
    if (/^[\d.,]+$/.test(clean)) {
      tagged.push({ type: 'value', text: clean, idx: i });
      continue;
    }

    // Text results like "Adequate", "Normal" — treat as a value (text, not numeric)
    if (/^(Adequate|Normal|Negative|Positive|Reactive|Non-reactive|Clear|Pale|Yellow|Straw)/i.test(clean)) {
      tagged.push({ type: 'value', text: '__TEXT__:' + clean, idx: i });
      continue;
    }

    // Skip all-uppercase short words that are likely section headers (not known markers)
    if (/^[A-Z\s&]+$/.test(clean) && clean.length > 2 && !KNOWN_MARKERS.has(clean.toLowerCase())) {
      tagged.push({ type: 'skip', text: clean, idx: i });
      continue;
    }

    // Is it a known marker name?
    const lc = clean.toLowerCase().replace(/[()]/g, '').trim();
    if (KNOWN_MARKERS.has(lc) || KNOWN_MARKERS.has(lc.replace(/\s+/g, ' '))) {
      tagged.push({ type: 'name', text: clean, idx: i });
      continue;
    }

    // Looks like a marker name? (starts with letter, reasonable length)
    if (/^[A-Za-z]/.test(clean) && clean.length >= 2 && clean.length <= 40 && !/^\d/.test(clean)) {
      // Skip if it looks like a specimen, method, or non-test text
      if (/blood|serum|plasma|urine|correction|assay|kinetic|blank|membership|mark berger|bangko/i.test(clean)) {
        tagged.push({ type: 'skip', text: clean, idx: i });
        continue;
      }
      tagged.push({ type: 'name', text: clean, idx: i });
      continue;
    }

    // Inline value with flag: "1.6" on its own after H flag
    tagged.push({ type: 'skip', text: clean, idx: i });
  }

  // Step 2: Pair names with their data
  // Strategy: collect all names first, then all value+unit+range groups, and zip them
  const names: string[] = [];
  const dataGroups: { value: number; textValue?: string; flag?: string; unit: string; refMin?: number; refMax?: number }[] = [];

  // Extract just names in order
  for (const t of tagged) {
    if (t.type === 'name') {
      names.push(cleanMarkerName(t.text));
    }
  }

  // Extract value groups: each group starts with a 'value' line, followed by optional flagunit and range
  let vi = 0;
  const nonSkip = tagged.filter(t => t.type !== 'skip' && t.type !== 'name');
  while (vi < nonSkip.length) {
    const t = nonSkip[vi];
    if (t.type === 'value') {
      const isTextValue = t.text.startsWith('__TEXT__:');
      const group: { value: number; textValue?: string; flag?: string; unit: string; refMin?: number; refMax?: number } = {
        value: isTextValue ? 0 : parseNumber(t.text),
        textValue: isTextValue ? t.text.replace('__TEXT__:', '') : undefined,
        unit: '',
      };

      // Text values consume their reference too (e.g., "Adequate" followed by "Adequate" as ref)
      if (isTextValue) {
        // Skip any following text that matches the same pattern (reference value)
        while (vi + 1 < nonSkip.length && nonSkip[vi + 1].type === 'value' && nonSkip[vi + 1].text.startsWith('__TEXT__:')) {
          vi++;
        }
        dataGroups.push(group);
        vi++;
        continue;
      }

      // Look ahead for unit/flag and range
      if (vi + 1 < nonSkip.length && nonSkip[vi + 1].type === 'flagunit') {
        const fu = nonSkip[vi + 1].text;
        const flagMatch = fu.match(/^([HL])\s+(.+)/i);
        if (flagMatch) {
          group.flag = flagMatch[1].toUpperCase();
          group.unit = flagMatch[2].trim();
        } else {
          group.unit = fu.trim();
        }
        vi++;
      }

      if (vi + 1 < nonSkip.length && nonSkip[vi + 1].type === 'range') {
        const rangeTxt = nonSkip[vi + 1].text;
        const rm = rangeTxt.match(/^[<>]?\s*([\d.,]+)\s*[-–]\s*([\d.,]+)/);
        if (rm) {
          group.refMin = parseNumber(rm[1]);
          group.refMax = parseNumber(rm[2]);
        } else {
          // Threshold like "<50" or ">55"
          const tm = rangeTxt.match(/^<\s*([\d.,]+)/);
          if (tm) { group.refMin = 0; group.refMax = parseNumber(tm[1]); }
          const tm2 = rangeTxt.match(/^>\s*([\d.,]+)/);
          if (tm2) { group.refMin = parseNumber(tm2[1]); }
        }
        vi++;
      }

      dataGroups.push(group);
    }
    vi++;
  }

  // Step 3: Zip names with data groups
  const values: BloodTestValue[] = [];
  const count = Math.min(names.length, dataGroups.length);
  for (let i = 0; i < count; i++) {
    values.push({
      name: names[i],
      value: dataGroups[i].value,
      unit: dataGroups[i].unit,
      textValue: dataGroups[i].textValue,
      refMin: dataGroups[i].refMin,
      refMax: dataGroups[i].refMax,
      flag: dataGroups[i].flag,
    });
  }

  return values;
}

function parseNumber(s: string): number {
  // Handle OCR issues: "5,200" → 5200, "50.4" stays 50.4
  // If comma is used as thousands separator (digits on both sides, >2 digits after): remove it
  let cleaned = s.trim();
  // "5,200" → "5200" (thousands separator)
  if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) {
    cleaned = cleaned.replace(/,/g, '');
  }
  // "1.234.567" style thousands → remove dots except last
  // But "50.4" should stay as is
  return parseFloat(cleaned.replace(',', '.'));
}

function parseBloodTestText(text: string): BloodTestValue[] {
  // First try column/marker-based format (Google Vision output)
  const columnResult = parseColumnFormat(text);
  if (columnResult.length > 3) return columnResult;

  // Then try multi-line grouped format
  const multiLineResult = parseMultiLineFormat(text);
  if (multiLineResult.length > 0) return multiLineResult;

  // Fall back to single-line parsing
  const values: BloodTestValue[] = [];

  const normalized = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ');

  const lines = normalized.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 3) continue;

    // Clean leading symbols (* • · - =)
    const cleaned = trimmed.replace(/^[\s*•·\-=_]+/, '').trim();
    if (!cleaned) continue;

    // Skip obvious junk
    if (isJunkLine(cleaned.split(/\s+/)[0] || '')) continue;

    // Patterns — ordered from most specific to least
    const patterns: Array<{ re: RegExp; groups: string[] }> = [
      // Name  Value  H/L  Unit  RefMin-RefMax
      { re: /^(.+?)\s+([\d.,]+)\s+([HL])\s+(\S+)\s+([\d.,]+)\s*[-–]\s*([\d.,]+)/i, groups: ['name','value','flag','unit','refMin','refMax'] },
      // Name  Value  H/L  Unit  RefMin  -  RefMax (spaces around dash)
      { re: /^(.+?)\s+([\d.,]+)\s+([HL])\s+(\S+)\s+([\d.,]+)\s*[-–]\s*([\d.,]+)/i, groups: ['name','value','flag','unit','refMin','refMax'] },
      // Name  Value  Unit  RefMin-RefMax
      { re: /^(.+?)\s+([\d.,]+)\s+(\S+)\s+([\d.,]+)\s*[-–]\s*([\d.,]+)/, groups: ['name','value','unit','refMin','refMax'] },
      // Name  Value  H/L  Unit
      { re: /^(.+?)\s+([\d.,]+)\s+([HL])\s+(\S+)\s*$/i, groups: ['name','value','flag','unit'] },
      // Name  Value  Unit
      { re: /^(.+?)\s+([\d.,]+)\s+(\S+)\s*$/, groups: ['name','value','unit'] },
      // Name  Value (no unit — still capture)
      { re: /^(.+?)\s+([\d.,]+)\s*$/, groups: ['name','value'] },
    ];

    let matched = false;
    for (const { re, groups } of patterns) {
      const match = cleaned.match(re);
      if (!match) continue;

      const parsed: Record<string, string> = {};
      groups.forEach((g, i) => { parsed[g] = match[i + 1]; });

      const name = cleanMarkerName(parsed.name || '');
      const value = parseNumber(parsed.value || '');
      const unit = parsed.unit || '';

      if (isNaN(value) || !name) continue;
      if (isJunkLine(name)) continue;
      if (unit && unit.length > 20) continue;
      // Skip if name is just digits
      if (/^\d+$/.test(name)) continue;

      const entry: BloodTestValue = { name, value, unit };

      if (parsed.refMin && parsed.refMax) {
        entry.refMin = parseNumber(parsed.refMin);
        entry.refMax = parseNumber(parsed.refMax);
      }
      if (parsed.flag) {
        entry.flag = parsed.flag.toUpperCase();
      }

      values.push(entry);
      matched = true;
      break;
    }

    // If no pattern matched, try splitting by multiple spaces (tabular OCR output)
    if (!matched) {
      const parts = cleaned.split(/\s{2,}/);
      if (parts.length >= 3) {
        const name = cleanMarkerName(parts[0]);
        const value = parseNumber(parts[1]);
        const rest = parts.slice(2).join(' ');
        const unitMatch = rest.match(/^([HL])?\s*(\S+)/i);

        if (!isNaN(value) && name && !isJunkLine(name) && !/^\d+$/.test(name)) {
          const entry: BloodTestValue = { name, value, unit: unitMatch?.[2] || '' };
          if (unitMatch?.[1]) entry.flag = unitMatch[1].toUpperCase();
          // Try to find range in remaining text
          const rangeMatch = rest.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
          if (rangeMatch) {
            entry.refMin = parseNumber(rangeMatch[1]);
            entry.refMax = parseNumber(rangeMatch[2]);
          }
          values.push(entry);
        }
      }
    }
  }

  return values;
}

function StatusDot({ value, refMin, refMax, flag }: { value: number; refMin?: number; refMax?: number; flag?: string }) {
  const isLow = flag === 'L' || (refMin != null && value < refMin);
  const isHigh = flag === 'H' || (refMax != null && value > refMax);
  if (!isLow && !isHigh && (refMin != null || refMax != null || flag)) {
    return <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />;
  }
  if (isHigh) return <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />;
  if (isLow) return <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />;
  return null;
}

export default function VitalsPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [tests, setTests] = useState<BloodTest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [testDate, setTestDate] = useState(new Date().toISOString().split('T')[0]);
  const [testLabel, setTestLabel] = useState('');
  const [parsedValues, setParsedValues] = useState<BloodTestValue[]>([]);
  const [expandedTest, setExpandedTest] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [popup, setPopup] = useState<{ title: string; content: string; loading: boolean } | null>(null);
  const explanationCache = useRef<Record<string, string>>({});

  // Initialize cache from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('markerExplanations');
      if (stored) explanationCache.current = JSON.parse(stored);
    } catch { /* ignore */ }
  }, []);

  const saveCache = (key: string, value: string) => {
    explanationCache.current[key] = value;
    try { localStorage.setItem('markerExplanations', JSON.stringify(explanationCache.current)); } catch { /* ignore */ }
  };

  const explainMarker = async (marker: string) => {
    const cacheKey = `explain:${marker.toLowerCase()}`;
    if (explanationCache.current[cacheKey]) {
      setPopup({ title: marker, content: explanationCache.current[cacheKey], loading: false });
      return;
    }
    setPopup({ title: marker, content: '', loading: true });
    try {
      const res = await fetch('/api/explain-marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marker, mode: 'explain' }),
      });
      const json = await res.json();
      const text = json.explanation || 'No explanation available.';
      saveCache(cacheKey, text);
      setPopup({ title: marker, content: text, loading: false });
    } catch {
      setPopup({ title: marker, content: 'Failed to load explanation.', loading: false });
    }
  };

  const diagnoseValue = async (v: BloodTestValue) => {
    const direction = v.flag === 'H' || (v.refMax != null && v.value > v.refMax) ? 'High' : 'Low';
    const cacheKey = `diagnose:${v.name.toLowerCase()}:${direction}:${v.value}`;
    if (explanationCache.current[cacheKey]) {
      setPopup({ title: `${v.name} — ${direction}`, content: explanationCache.current[cacheKey], loading: false });
      return;
    }
    setPopup({ title: `${v.name} — ${direction}`, content: '', loading: true });
    try {
      const res = await fetch('/api/explain-marker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marker: v.name, value: v.value, unit: v.unit, refMin: v.refMin, refMax: v.refMax, flag: v.flag, mode: 'diagnose' }),
      });
      const json = await res.json();
      const text = json.explanation || 'No explanation available.';
      saveCache(cacheKey, text);
      setPopup({ title: `${v.name} — ${direction}`, content: text, loading: false });
    } catch {
      setPopup({ title: `${v.name} — ${direction}`, content: 'Failed to load explanation.', loading: false });
    }
  };
  const [editingTestId, setEditingTestId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<BloodTestValue[]>([]);
  const [editDate, setEditDate] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Lifestyle dashboard state
  const [trainingSessions, setTrainingSessions] = useState<TrainingSession[]>([]);
  const [nutritionPlan, setNutritionPlan] = useState<NutritionPlan | null>(null);
  const [latestWeight, setLatestWeight] = useState<number>(0);
  const [avgSleep, setAvgSleep] = useState<string>('');
  const [lsTrt, setLsTrt] = useState('Unknown');
  const [lsAlcohol, setLsAlcohol] = useState('None');
  const [lsProcessedFood, setLsProcessedFood] = useState('None');
  const [lsWater, setLsWater] = useState('4+ L/day');
  const [lsCoffee, setLsCoffee] = useState('2-5 cups/day');
  const [lsStress, setLsStress] = useState('Moderate');

  // Analysis state
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [viewingAnalysis, setViewingAnalysis] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      getBloodTests().then(t => {
        setTests(t.sort((a, b) => b.date.localeCompare(a.date)));
        setLoaded(true);
      });
      // Lifestyle data
      getTrainingSessions().then(setTrainingSessions);
      getNutritionPlan().then(p => { if (p && 'current' in p) setNutritionPlan(p as NutritionPlan); });
      getMeasurements().then(ms => { if (ms.length > 0) setLatestWeight(ms[ms.length - 1].weight); });
      fetch('/api/oura?days=7').then(r => r.json()).then(d => {
        if (d.data && d.data.length > 0) {
          const sleepHours = d.data.filter((s: { totalSleep?: number }) => s.totalSleep).map((s: { totalSleep: number }) => Math.round(s.totalSleep / 3600 * 10) / 10);
          if (sleepHours.length > 0) setAvgSleep(`${(sleepHours.reduce((a: number, b: number) => a + b, 0) / sleepHours.length).toFixed(1)}h/night`);
        }
      }).catch(() => {});
      // Load manual lifestyle settings
      getSetting('ls_trt').then(v => { if (v) setLsTrt(v); });
      getSetting('ls_alcohol').then(v => { if (v) setLsAlcohol(v); });
      getSetting('ls_processedFood').then(v => { if (v) setLsProcessedFood(v); });
      getSetting('ls_water').then(v => { if (v) setLsWater(v); });
      getSetting('ls_coffee').then(v => { if (v) setLsCoffee(v); });
      getSetting('ls_stress').then(v => { if (v) setLsStress(v); });
    }
  }, [isAuthenticated]);

  const handleParse = () => {
    const values = parseBloodTestText(pasteText);
    setParsedValues(values);
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    // First try: extract embedded text
    let allText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      const parts: string[] = [];
      for (const item of content.items) {
        const textItem = item as { str?: string; transform?: number[] };
        if (!textItem.str) continue;
        const y = textItem.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
          parts.push('\n');
        }
        parts.push(textItem.str);
        if (y !== undefined) lastY = y;
      }
      allText += parts.join(' ').replace(/ \n /g, '\n') + '\n\n';
    }

    // If enough text was extracted, use it
    if (allText.trim().length > 20) {
      return allText.trim();
    }

    // Fallback: OCR via Google Vision API (for scanned PDFs)
    return '__NEEDS_CLOUD_OCR__';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    try {
      if (file.type === 'text/plain' || file.type === 'text/csv') {
        // Text files: parse locally
        const text = await file.text();
        setPasteText(text);
        setParsedValues(parseBloodTestText(text));
      } else {
        // PDF/images: Google Vision OCR → Claude parsing
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/api/parse-bloodtest', { method: 'POST', body: formData });
        const json = await res.json();

        if (!res.ok) {
          alert(json.error || 'Could not process file');
          setProcessing(false);
          return;
        }

        if (json.ocrText) setPasteText(json.ocrText);

        if (json.values && json.values.length > 0) {
          setParsedValues(json.values.map((v: BloodTestValue) => ({
            name: v.name || '',
            value: v.value || 0,
            unit: v.unit || '',
            textValue: v.textValue,
            refMin: v.refMin,
            refMax: v.refMax,
            flag: v.flag,
          })));
        } else {
          alert('Could not extract values. You can add them manually.');
        }
      }
    } catch (err) {
      console.error('File processing error:', err);
      alert('Could not process file. Try copy/pasting the text instead.');
    }
    setProcessing(false);
  };

  const computeFlag = (entry: BloodTestValue): string | undefined => {
    const { value, refMin, refMax } = entry;
    if (refMax != null && value > refMax) return 'H';
    if (refMin != null && value < refMin) return 'L';
    if (refMin != null || refMax != null) return undefined;
    return entry.flag;
  };

  const updateParsedValue = (idx: number, field: keyof BloodTestValue, val: string) => {
    setParsedValues(prev => {
      const updated = [...prev];
      if (field === 'value' || field === 'refMin' || field === 'refMax') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updated[idx] as any)[field] = val ? parseFloat(val) : undefined;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updated[idx] as any)[field] = val;
      }
      if (field === 'value' || field === 'refMin' || field === 'refMax') {
        updated[idx].flag = computeFlag(updated[idx]);
      }
      return updated;
    });
  };

  const addEmptyValue = () => {
    setParsedValues(prev => [...prev, { name: '', value: 0, unit: '' }]);
  };

  const insertValueAt = (idx: number) => {
    setParsedValues(prev => {
      const updated = [...prev];
      updated.splice(idx, 0, { name: '', value: 0, unit: '' });
      return updated;
    });
  };

  const removeValue = (idx: number) => {
    setParsedValues(prev => prev.filter((_, i) => i !== idx));
  };

  const saveTest = async () => {
    const cleaned = parsedValues.filter(v => v.name.trim() && !isNaN(v.value));
    if (cleaned.length === 0) return;

    const newTest: BloodTest = {
      id: Date.now().toString(),
      date: testDate,
      label: testLabel || undefined,
      rawText: pasteText || undefined,
      values: cleaned,
    };

    const updated = [newTest, ...tests].sort((a, b) => b.date.localeCompare(a.date));
    setTests(updated);
    await saveBloodTests(updated);
    setShowAdd(false);
    setPasteText('');
    setParsedValues([]);
    setTestLabel('');
  };

  const startEditTest = (test: BloodTest) => {
    setEditingTestId(test.id);
    setEditValues(JSON.parse(JSON.stringify(test.values)));
    setEditDate(test.date);
    setExpandedTest(test.id);
  };

  const saveEditTest = async () => {
    if (!editingTestId) return;
    const cleaned = editValues.filter(v => v.name.trim());
    const updated = tests.map(t => t.id === editingTestId ? { ...t, values: cleaned, date: editDate || t.date } : t)
      .sort((a, b) => b.date.localeCompare(a.date));
    setTests(updated);
    await saveBloodTests(updated);
    setEditingTestId(null);
    setEditValues([]);
    setEditDate('');
  };

  const updateEditValue = (idx: number, field: keyof BloodTestValue, val: string) => {
    setEditValues(prev => {
      const updated = [...prev];
      if (field === 'value' || field === 'refMin' || field === 'refMax') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updated[idx] as any)[field] = val ? parseFloat(val) : undefined;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (updated[idx] as any)[field] = val;
      }
      if (field === 'value' || field === 'refMin' || field === 'refMax') {
        updated[idx].flag = computeFlag(updated[idx]);
      }
      return updated;
    });
  };

  const removeEditValue = (idx: number) => {
    setEditValues(prev => prev.filter((_, i) => i !== idx));
  };

  const addEditValue = () => {
    setEditValues(prev => [...prev, { name: '', value: 0, unit: '' }]);
  };

  const insertEditValueAt = (idx: number) => {
    setEditValues(prev => {
      const updated = [...prev];
      updated.splice(idx, 0, { name: '', value: 0, unit: '' });
      return updated;
    });
  };

  const deleteTest = async (id: string) => {
    if (!confirm('Delete this blood test?')) return;
    const updated = tests.filter(t => t.id !== id);
    setTests(updated);
    await saveBloodTests(updated);
  };

  // Build comparison data: markers ordered by latest test, then fill from older tests
  const getComparisonData = () => {
    const markerMap: Record<string, { name: string; unit: string; refMin?: number; refMax?: number }> = {};
    const orderedKeys: string[] = [];

    // Start with the latest test's markers in order
    const latestTest = tests[0];
    if (latestTest) {
      for (const v of latestTest.values) {
        const key = v.name.toLowerCase();
        if (!markerMap[key]) {
          markerMap[key] = { name: v.name, unit: v.unit, refMin: v.refMin, refMax: v.refMax };
          orderedKeys.push(key);
        }
      }
    }

    // Then add any markers from older tests that aren't in the latest
    for (let i = 1; i < tests.length; i++) {
      for (const v of tests[i].values) {
        const key = v.name.toLowerCase();
        if (!markerMap[key]) {
          markerMap[key] = { name: v.name, unit: v.unit, refMin: v.refMin, refMax: v.refMax };
          orderedKeys.push(key);
        }
        // Update ref range if we have better data
        if (v.refMin != null) markerMap[key].refMin = markerMap[key].refMin ?? v.refMin;
        if (v.refMax != null) markerMap[key].refMax = markerMap[key].refMax ?? v.refMax;
      }
    }

    return orderedKeys.map(key => ({
      name: markerMap[key].name,
      unit: markerMap[key].unit,
      refMin: markerMap[key].refMin,
      refMax: markerMap[key].refMax,
    }));
  };

  // Derived lifestyle values
  const now7 = new Date();
  const weekAgoStr = new Date(now7.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const recentSessions = trainingSessions.filter(s => {
    if (s.date < weekAgoStr) return false;
    if (s.workoutName === 'Cardio') {
      const mins = s.exercises?.reduce((t, ex) => {
        const m = (ex.targetReps || '').match(/(\d+)\s*min/i);
        return t + (m ? parseInt(m[1]) : 0);
      }, 0) || 0;
      return mins >= 60;
    }
    return true;
  });
  const trainingFreq = recentSessions.length;
  const proteinG = nutritionPlan?.current.trainingDay.macros.protein || 0;
  const proteinPerKg = latestWeight > 0 ? (proteinG / latestWeight).toFixed(1) : '?';
  const allSupplements = [
    ...(nutritionPlan?.current.emptyStomach || []),
    ...(nutritionPlan?.current.trainingDay.meals || []).flatMap(m => m.supplements || []),
  ];
  const uniqueSupplements = [...new Set(allSupplements.map(s => s.replace(/\s+\d[\d.,]*\s*(?:mg|gr?|iu|mcg|ml|caps?|tablets?|scoops?)\s*$/i, '').trim()))];

  const saveLifestyle = (key: string, value: string, setter: (v: string) => void) => {
    setter(value);
    saveSetting(`ls_${key}`, value);
  };

  const getLifestyleContext = () => ({
    trainingFrequency: `${trainingFreq}`,
    trainingType: 'heavy resistance training',
    weight: latestWeight > 0 ? `${latestWeight}` : 'Unknown',
    proteinIntake: proteinG > 0 ? `${proteinG}g/day (${proteinPerKg} g/kg)` : 'Unknown',
    supplements: uniqueSupplements.length > 0 ? uniqueSupplements.join(', ') : 'None',
    trt: lsTrt,
    alcohol: lsAlcohol,
    processedFood: lsProcessedFood,
    water: lsWater,
    coffee: lsCoffee,
    sleep: avgSleep || 'Unknown',
    stress: lsStress,
  });

  const handleAnalyse = async (test: BloodTest) => {
    setAnalysing(test.id);
    try {
      const previousTests = tests.filter(t => t.id !== test.id && t.date < test.date).slice(0, 3).map(t => ({
        date: t.date, label: t.label, values: t.values,
      }));
      const res = await fetch('/api/analyse-bloodtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: test.values, lifestyle: getLifestyleContext(), previousTests }),
      });
      const json = await res.json();
      if (json.html) {
        const updated = tests.map(t => t.id === test.id ? { ...t, analysis: json.html } : t);
        setTests(updated);
        await saveBloodTests(updated);
        setViewingAnalysis(test.id);
      }
    } catch (e) {
      console.error('Analysis failed:', e);
    }
    setAnalysing(null);
  };

  if (isLoading || !isAuthenticated || !loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-4">Vitals</h1>

          {/* Actions */}
          <div className="flex gap-3 mb-6">
            <button onClick={() => setShowAdd(!showAdd)} className="btn-primary text-sm px-4 py-2">
              {showAdd ? 'Cancel' : '+ Add Blood Test'}
            </button>
            {tests.length >= 2 && (
              <button
                onClick={() => setShowComparison(!showComparison)}
                className="text-sm px-4 py-2 rounded-xl border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 transition-all"
              >
                {showComparison ? 'Hide Comparison' : 'Compare Over Time'}
              </button>
            )}
          </div>

          {/* Lifestyle Dashboard */}
          <div className="glass-card p-5 mb-6">
            <h2 className="text-sm font-semibold text-white mb-3">Lifestyle Profile</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {/* Auto-derived */}
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[10px] text-white/30 uppercase">Training</p>
                <p className="text-white font-medium">{trainingFreq}x / week</p>
                <p className="text-[9px] text-cyan-400/50">from training log</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[10px] text-white/30 uppercase">Protein</p>
                <p className="text-white font-medium">{proteinG > 0 ? `${proteinG}g (${proteinPerKg} g/kg)` : '—'}</p>
                <p className="text-[9px] text-cyan-400/50">from nutrition plan</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[10px] text-white/30 uppercase">Weight</p>
                <p className="text-white font-medium">{latestWeight > 0 ? `${latestWeight} kg` : '—'}</p>
                <p className="text-[9px] text-cyan-400/50">from measurements</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3">
                <p className="text-[10px] text-white/30 uppercase">Sleep</p>
                <p className="text-white font-medium">{avgSleep || '—'}</p>
                <p className="text-[9px] text-cyan-400/50">via Oura (7d avg)</p>
              </div>
              <div className="bg-white/5 rounded-xl p-3 col-span-2 sm:col-span-3">
                <p className="text-[10px] text-white/30 uppercase mb-1">Supplements</p>
                <p className="text-white/70 text-xs">{uniqueSupplements.length > 0 ? uniqueSupplements.join(', ') : '—'}</p>
                <p className="text-[9px] text-cyan-400/50">from nutrition plan</p>
              </div>
              {/* Manual inputs */}
              {([
                { key: 'trt', label: 'TRT', value: lsTrt, setter: setLsTrt, options: ['Yes', 'No', 'Unknown'] },
                { key: 'alcohol', label: 'Alcohol', value: lsAlcohol, setter: setLsAlcohol, options: ['None', 'Light', 'Moderate', 'Heavy'] },
                { key: 'processedFood', label: 'Processed Food', value: lsProcessedFood, setter: setLsProcessedFood, options: ['None', 'Some', 'Frequent'] },
                { key: 'water', label: 'Water', value: lsWater, setter: setLsWater, options: ['<2 L/day', '2-3 L/day', '3-4 L/day', '4-5 L/day', '5-6 L/day', '6+ L/day'] },
                { key: 'coffee', label: 'Coffee', value: lsCoffee, setter: setLsCoffee, options: ['None', '1 cup/day', '2-3 cups/day', '2-5 cups/day', '5+ cups/day'] },
                { key: 'stress', label: 'Stress', value: lsStress, setter: setLsStress, options: ['Low', 'Moderate', 'High'] },
              ] as const).map(field => (
                <div key={field.key} className="bg-white/5 rounded-xl p-3">
                  <p className="text-[10px] text-white/30 uppercase mb-1">{field.label}</p>
                  <select
                    value={field.value}
                    onChange={e => saveLifestyle(field.key, e.target.value, field.setter as (v: string) => void)}
                    className="w-full bg-white/10 text-white text-xs rounded-lg px-2 py-1.5 outline-none border border-white/10"
                  >
                    {field.options.map(opt => <option key={opt} value={opt} className="bg-[#1a1d27]">{opt}</option>)}
                  </select>
                  <p className="text-[9px] text-white/30 mt-1">manual</p>
                </div>
              ))}
            </div>
          </div>

          {/* Add form */}
          {showAdd && (
            <div className="glass-card p-5 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">Add Blood Test</h2>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-white/40 block mb-1">Date</label>
                  <input type="date" className="glass-input w-full px-3 py-2" value={testDate} onChange={e => setTestDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-white/40 block mb-1">Label (optional)</label>
                  <input type="text" className="glass-input w-full px-3 py-2" placeholder="e.g. Routine checkup" value={testLabel} onChange={e => setTestLabel(e.target.value)} />
                </div>
              </div>

              {/* Upload PDF */}
              <div className="mb-4">
                <label className="w-full block cursor-pointer">
                  <div className="glass-input flex items-center justify-center gap-3 py-6 text-center hover:bg-white/10 transition-all border-2 border-dashed border-white/15">
                    {processing ? (
                      <span className="text-white/50 text-sm">Extracting &amp; analyzing... (10-30s)</span>
                    ) : (
                      <>
                        <span className="text-white/50 text-sm">Tap to upload blood test</span>
                        <span className="text-xs text-va-red font-semibold">.pdf .txt .csv</span>
                      </>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept=".pdf,.txt,.csv,image/*" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>

              {/* Or paste text */}
              <div className="mb-4">
                <label className="text-xs text-white/40 block mb-1">Or paste blood test results</label>
                <textarea
                  className="glass-input w-full px-3 py-2 min-h-[100px] text-sm font-mono"
                  placeholder={"Hemoglobin 14.5 g/dL (12.0 - 16.0)\nTestosterone 650 ng/dL (300-1000)\nTSH 2.5 mIU/L 0.4-4.0"}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                />
                {pasteText && parsedValues.length === 0 && (
                  <button onClick={handleParse} className="text-xs text-va-red hover:text-va-red-light mt-2">Parse Text</button>
                )}
              </div>

              {/* Parsed / manual values */}
              {parsedValues.length > 0 && (
                <div className="mb-4">
                  <label className="text-xs text-white/40 block mb-2">Extracted values — edit as needed</label>
                  <div className="space-y-2">
                    <div className="hidden">
                      <span>Marker</span>
                      <span>Value</span>
                      <span>Unit</span>
                      <span>Ref min</span>
                      <span>Ref max</span>
                      <span></span>
                    </div>
                    {parsedValues.map((v, i) => (
                      <div key={i}>
                      {i > 0 && (
                        <button onClick={() => insertValueAt(i)} className="w-full flex items-center justify-center py-1 group">
                          <span className="text-white/10 group-hover:text-white/40 text-lg transition-all">+</span>
                        </button>
                      )}
                      <div className={`glass p-3 rounded-xl flex gap-2 items-start ${v.flag === 'H' ? 'border border-red-500/20' : v.flag === 'L' ? 'border border-yellow-500/20' : ''}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex gap-1.5 mb-1.5">
                            <input className="glass-input flex-[2] px-2 py-1.5 text-sm font-semibold" value={v.name} onChange={e => updateParsedValue(i, 'name', e.target.value)} placeholder="Marker" />
                            <input className="glass-input w-20 px-2 py-1.5 text-sm text-right" type="number" value={v.value || ''} onChange={e => updateParsedValue(i, 'value', e.target.value)} placeholder="Value" />
                            <input className="glass-input w-16 px-2 py-1.5 text-sm" value={v.unit} onChange={e => updateParsedValue(i, 'unit', e.target.value)} placeholder="Unit" />
                          </div>
                          <div className="flex gap-1.5">
                            <span className="text-[10px] text-white/20 self-center w-8">Ref:</span>
                            <input className="glass-input w-20 px-2 py-1 text-xs text-right" type="number" value={v.refMin ?? ''} onChange={e => updateParsedValue(i, 'refMin', e.target.value)} placeholder="min" />
                            <span className="text-white/20 self-center">–</span>
                            <input className="glass-input w-20 px-2 py-1 text-xs text-right" type="number" value={v.refMax ?? ''} onChange={e => updateParsedValue(i, 'refMax', e.target.value)} placeholder="max" />
                            {v.flag && <span className={`text-xs font-bold self-center ml-1 ${v.flag === 'H' ? 'text-red-400' : 'text-yellow-400'}`}>{v.flag}</span>}
                          </div>
                        </div>
                        <button onClick={() => removeValue(i)} className="text-red-400/30 hover:text-red-400 hover:bg-red-400/10 rounded-lg p-2 transition-all shrink-0" title="Delete">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={addEmptyValue} className="text-xs text-white/30 hover:text-white/50 mt-2">+ Add marker</button>
                </div>
              )}

              <div className="flex gap-3 items-center mt-3">
                <button onClick={addEmptyValue} className="text-sm px-4 py-2 rounded-xl border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 transition-all">+ Add Row</button>
                {parsedValues.length > 0 && (
                  <button onClick={saveTest} className="btn-primary text-sm px-6 py-2 ml-auto">Save Blood Test</button>
                )}
              </div>
            </div>
          )}

          {/* Comparison view */}
          {showComparison && tests.length >= 2 && (
            <div className="glass-card p-5 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">Comparison Over Time</h2>
              <div className="overflow-x-auto -mx-5 px-5">
              <table className="min-w-max text-sm">
                <thead>
                  <tr className="text-white/30 text-left border-b border-white/5">
                    <th className="pb-2 pr-4 font-normal">Marker</th>
                    <th className="pb-2 pr-4 font-normal text-right">Ref</th>
                    {[...tests].reverse().map(t => (
                      <th key={t.id} className="pb-2 px-2 font-normal text-right whitespace-nowrap">
                        {new Date(t.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {getComparisonData().map(marker => (
                    <tr key={marker.name} className="border-t border-white/5">
                      <td className="py-1.5 pr-4 text-white/60">{marker.name}</td>
                      <td className="py-1.5 pr-4 text-white/20 text-right text-xs whitespace-nowrap">
                        {marker.refMin != null && marker.refMax != null ? `${marker.refMin}–${marker.refMax}` : ''}
                        {marker.unit ? ` ${marker.unit}` : ''}
                      </td>
                      {[...tests].reverse().map((test, colIdx, reversed) => {
                        const val = test.values.find(v => v.name.toLowerCase() === marker.name.toLowerCase());
                        if (!val) return <td key={test.id} className="py-1.5 px-2 text-right text-white/15">—</td>;

                        const isLow = marker.refMin != null && val.value < marker.refMin;
                        const isHigh = marker.refMax != null && val.value > marker.refMax;
                        const color = isLow ? 'text-yellow-400' : isHigh ? 'text-red-400' : 'text-white/70';

                        // Show diff only on the last column (newest), compared to previous
                        const isLastCol = colIdx === reversed.length - 1;
                        const prevTest = isLastCol && colIdx > 0 ? reversed[colIdx - 1] : null;
                        const prevVal = prevTest?.values.find(v => v.name.toLowerCase() === marker.name.toLowerCase());
                        const diff = prevVal ? val.value - prevVal.value : null;

                        // Don't show diff for text values
                        const displayValue = val.textValue || val.value;
                        const showDiff = !val.textValue && diff != null && diff !== 0;

                        return (
                          <td key={test.id} className={`py-1.5 px-2 text-right font-mono text-xs ${val.textValue ? 'text-white/50 font-sans' : color}`}>
                            {displayValue}
                            {showDiff && (
                              <span className={`ml-1 text-[9px] ${diff! > 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                                {diff! > 0 ? '+' : ''}{Math.round(diff! * 10) / 10}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Blood test list */}
          {tests.length === 0 && !showAdd && (
            <EmptyState icon="bloodtest" message="No blood tests recorded yet" action="Add Your First Blood Test" onAction={() => setShowAdd(true)} />
          )}

          <div className="space-y-3">
            {tests.map(test => {
              const isExpanded = expandedTest === test.id;
              const outOfRange = test.values.filter(v => v.refMin != null && v.refMax != null && (v.value < v.refMin || v.value > v.refMax));

              return (
                <div key={test.id} className="glass-card overflow-hidden">
                  <div
                    onClick={() => setExpandedTest(isExpanded ? null : test.id)}
                    className="w-full p-4 flex items-center justify-between text-left cursor-pointer"
                  >
                    <div>
                      <span className="text-white font-medium">
                        {new Date(test.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {test.label && <span className="text-white/30 text-sm ml-2">{test.label}</span>}
                      <span className="text-white/20 text-xs ml-2">{test.values.length} markers</span>
                      {outOfRange.length > 0 && (
                        <span className="text-yellow-400/60 text-xs ml-2">{outOfRange.length} out of range</span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      {test.analysis ? (<>
                        <button
                          onClick={(e) => { e.stopPropagation(); setViewingAnalysis(test.id); }}
                          className="text-xs text-green-400/70 hover:text-green-400 px-2 py-1"
                        >
                          View Report
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            const updated = tests.map(t => t.id === test.id ? { ...t, analysis: undefined } : t);
                            setTests(updated);
                            await saveBloodTests(updated);
                          }}
                          className="text-xs text-white/20 hover:text-red-400 px-2 py-1"
                        >
                          Del Report
                        </button>
                      </>) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAnalyse(test); }}
                          disabled={analysing === test.id}
                          className="text-xs text-blue-400/70 hover:text-blue-400 px-2 py-1 disabled:opacity-50"
                        >
                          {analysing === test.id ? 'Analysing...' : 'Analyse'}
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditTest(test); }}
                        className="text-xs text-white/30 hover:text-white/70 px-2 py-1"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteTest(test.id); }}
                        className="text-xs text-white/20 hover:text-red-400 px-2 py-1"
                      >
                        Delete
                      </button>
                      <span className={`text-white/20 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    </div>
                  </div>

                  {isExpanded && editingTestId !== test.id && (
                    <div className="px-4 pb-4 border-t border-white/5">
                      <table className="w-full text-sm mt-2">
                        <thead>
                          <tr className="text-white/30 text-left">
                            <th className="pb-1 font-normal"></th>
                            <th className="pb-1 font-normal">Marker</th>
                            <th className="pb-1 font-normal text-right">Value</th>
                            <th className="pb-1 font-normal text-right">Unit</th>
                            <th className="pb-1 font-normal text-right">Reference</th>
                          </tr>
                        </thead>
                        <tbody>
                          {test.values.map((v, i) => {
                            const isLow = v.flag === 'L' || (v.refMin != null && v.value < v.refMin);
                            const isHigh = v.flag === 'H' || (v.refMax != null && v.value > v.refMax);
                            const rowColor = isLow ? 'bg-yellow-500/5' : isHigh ? 'bg-red-500/5' : '';
                            const valColor = isLow ? 'text-yellow-400' : isHigh ? 'text-red-400' : 'text-white/80';
                            const nameColor = isLow ? 'text-yellow-400/80' : isHigh ? 'text-red-400/80' : 'text-white/60';
                            return (
                              <tr key={i} className={`border-t border-white/5 ${rowColor}`}>
                                <td className="py-1 w-6"><StatusDot value={v.value} refMin={v.refMin} refMax={v.refMax} flag={v.flag} /></td>
                                <td className={`py-1 ${nameColor}`}>
                                  <span onClick={() => explainMarker(v.name)} className="cursor-pointer underline decoration-dotted decoration-white/20 hover:decoration-white/50">{v.name}</span>
                                  {(isHigh || isLow) && <span className={`ml-1 text-[10px] font-bold ${isHigh ? 'text-red-400' : 'text-yellow-400'}`}>{isHigh ? 'H' : 'L'}</span>}
                                </td>
                                <td className={`py-1 text-right font-mono ${valColor}`}>
                                  {(isHigh || isLow) ? (
                                    <span onClick={() => diagnoseValue(v)} className="cursor-pointer underline decoration-dotted hover:opacity-80">{v.textValue || v.value}</span>
                                  ) : (
                                    <span>{v.textValue || v.value}</span>
                                  )}
                                </td>
                                <td className="py-1 text-right text-white/30 text-xs">{v.unit}</td>
                                <td className="py-1 text-right text-white/20 text-xs">
                                  {v.refMin != null && v.refMax != null ? `${v.refMin}–${v.refMax}` : v.refMax != null ? `<${v.refMax}` : v.refMin != null ? `>${v.refMin}` : ''}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {isExpanded && editingTestId === test.id && (
                    <div className="px-4 pb-4 border-t border-white/5 mt-2">
                      <div className="flex items-center gap-3 mb-3">
                        <div>
                          <label className="text-[10px] text-white/30 block">Date</label>
                          <input type="date" className="glass-input px-2 py-1 text-sm" value={editDate} onChange={e => setEditDate(e.target.value)} />
                        </div>
                        <button onClick={saveEditTest} className="btn-primary text-sm px-4 py-1.5 ml-auto">Save</button>
                        <button onClick={() => setEditingTestId(null)} className="text-sm px-4 py-1.5 rounded-xl border border-white/20 bg-white/10 text-white/80">Cancel</button>
                      </div>
                      <div className="space-y-1.5">
                        {editValues.map((v, i) => (
                          <div key={i}>
                          {i > 0 && (
                            <button onClick={() => insertEditValueAt(i)} className="w-full flex items-center justify-center py-1 group">
                              <span className="text-white/10 group-hover:text-white/40 text-lg transition-all">+</span>
                            </button>
                          )}
                          <div className={`glass p-3 rounded-xl flex gap-2 items-start ${v.flag === 'H' ? 'border border-red-500/20' : v.flag === 'L' ? 'border border-yellow-500/20' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <div className="flex gap-1.5 mb-1.5">
                                <input className="glass-input flex-[2] px-2 py-1.5 text-sm font-semibold" value={v.name} onChange={e => updateEditValue(i, 'name', e.target.value)} placeholder="Marker" />
                                <input className="glass-input w-20 px-2 py-1.5 text-sm text-right" type="number" value={v.value || ''} onChange={e => updateEditValue(i, 'value', e.target.value)} placeholder="Value" />
                                <input className="glass-input w-16 px-2 py-1.5 text-sm" value={v.unit} onChange={e => updateEditValue(i, 'unit', e.target.value)} placeholder="Unit" />
                              </div>
                              <div className="flex gap-1.5">
                                <span className="text-[10px] text-white/20 self-center w-8">Ref:</span>
                                <input className="glass-input w-20 px-2 py-1 text-xs text-right" type="number" value={v.refMin ?? ''} onChange={e => updateEditValue(i, 'refMin', e.target.value)} placeholder="min" />
                                <span className="text-white/20 self-center">–</span>
                                <input className="glass-input w-20 px-2 py-1 text-xs text-right" type="number" value={v.refMax ?? ''} onChange={e => updateEditValue(i, 'refMax', e.target.value)} placeholder="max" />
                              </div>
                            </div>
                            <button onClick={() => removeEditValue(i)} className="text-red-400/30 hover:text-red-400 hover:bg-red-400/10 rounded-lg p-2 transition-all shrink-0" title="Delete">
                              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3 mt-3">
                        <button onClick={addEditValue} className="text-xs text-white/30 hover:text-white/50">+ Add marker</button>
                        <button onClick={saveEditTest} className="btn-primary text-sm px-4 py-1.5 ml-auto">Save</button>
                        <button onClick={() => setEditingTestId(null)} className="text-sm px-4 py-1.5 rounded-xl border border-white/20 bg-white/10 text-white/80">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
      {viewingAnalysis && (() => {
        const test = tests.find(t => t.id === viewingAnalysis);
        if (!test?.analysis) return null;
        return (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-start justify-center overflow-y-auto p-4">
            <div className="bg-white rounded-2xl max-w-4xl w-full my-8 relative">
              <div className="sticky top-0 bg-white rounded-t-2xl border-b px-6 py-4 flex items-center justify-between z-10">
                <h2 className="text-lg font-bold text-gray-800">
                  Lab Report — {new Date(test.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </h2>
                <button onClick={() => setViewingAnalysis(null)} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
              </div>
              <div className="p-6" dangerouslySetInnerHTML={{ __html: test.analysis }} />
            </div>
          </div>
        );
      })()}
      {popup && (
        <MarkerPopup
          title={popup.title}
          content={popup.content}
          loading={popup.loading}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}
