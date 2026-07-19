/**
 * Canonical blood-marker registry.
 *
 * Lab reports name the same analyte many ways ("LDL", "LDL-Cholesterol",
 * "Cholesterol LDL", "LDL-C"). The vitals comparison keys markers by name, so
 * those variants used to split into separate rows and never lined up over time.
 *
 * This module maps every known variant to ONE canonical marker, tagged with a
 * clinical category and a stable display order. Anything we can't confidently
 * match is kept verbatim and sorted into "Other" at the end — we never merge
 * two markers we're unsure about (a duplicate row is safer than a wrong merge).
 *
 * Names + order only. Unit reconciliation is intentionally out of scope here.
 */

export type MarkerCategory =
  | 'Hematology'
  | 'Glucose & Metabolic'
  | 'Lipids'
  | 'Liver'
  | 'Kidney'
  | 'Electrolytes & Minerals'
  | 'Iron Studies'
  | 'Thyroid'
  | 'Hormones'
  | 'Vitamins'
  | 'Inflammation'
  | 'Tumor Markers'
  | 'Other';

// Clinical panel sequence (top → bottom of the comparison table).
export const CATEGORY_ORDER: MarkerCategory[] = [
  'Hematology',
  'Glucose & Metabolic',
  'Lipids',
  'Liver',
  'Kidney',
  'Electrolytes & Minerals',
  'Iron Studies',
  'Thyroid',
  'Hormones',
  'Vitamins',
  'Inflammation',
  'Tumor Markers',
  'Other',
];

// Registry grouped by category, in the desired within-category order. Each row
// is [canonicalName, ...aliases]. The canonical name is itself always an alias.
const REGISTRY: Record<Exclude<MarkerCategory, 'Other'>, [string, ...string[]][]> = {
  Hematology: [
    ['WBC', 'white blood cell', 'white blood cells', 'wbc count', 'leukocytes', 'leukocyte count', 'total wbc'],
    ['RBC', 'red blood cell', 'red blood cells', 'rbc count', 'erythrocytes'],
    ['Hemoglobin', 'hb', 'hgb', 'haemoglobin'],
    ['Hematocrit', 'hct', 'haematocrit', 'pcv', 'packed cell volume'],
    ['MCV', 'mean corpuscular volume'],
    ['MCH', 'mean corpuscular hemoglobin'],
    ['MCHC', 'mean corpuscular hemoglobin concentration'],
    ['RDW', 'rdw cv', 'red cell distribution width'],
    ['Platelet Count', 'platelets', 'plt', 'platelet'],
    ['MPV', 'mean platelet volume'],
    ['Neutrophils', 'neutrophil', 'neutrophils %', 'segmenters', 'segmented neutrophils'],
    ['Lymphocytes', 'lymphocyte', 'lymphocytes %'],
    ['Monocytes', 'monocyte', 'monocytes %'],
    ['Eosinophils', 'eosinophil', 'eosinophils %'],
    ['Basophils', 'basophil', 'basophils %'],
    ['Absolute Neutrophils', 'absolute neutrophil count', 'anc', 'neutrophils absolute'],
    ['Absolute Lymphocytes', 'absolute lymphocyte count', 'alc', 'lymphocytes absolute'],
    ['RBC Morphology', 'red cell morphology'],
    ['Platelet Smear', 'platelet estimate', 'platelet adequacy'],
  ],
  'Glucose & Metabolic': [
    ['Glucose', 'fbs', 'fasting blood sugar', 'fasting glucose', 'blood glucose', 'glucose fasting', 'plasma glucose'],
    ['HbA1c', 'a1c', 'hemoglobin a1c', 'glycated hemoglobin', 'glycosylated hemoglobin', 'hba 1c'],
    ['Insulin', 'fasting insulin', 'serum insulin'],
  ],
  Lipids: [
    ['Total Cholesterol', 'cholesterol', 'cholesterol total', 'total chol', 'chol'],
    ['LDL Cholesterol', 'ldl', 'ldl c', 'ldl chol', 'cholesterol ldl', 'ldl direct', 'ldl calculated', 'ldl cholesterol calc'],
    ['HDL Cholesterol', 'hdl', 'hdl c', 'hdl chol', 'cholesterol hdl'],
    ['Triglycerides', 'triglyceride', 'tg', 'trigs', 'triacylglycerol'],
    ['Non-HDL Cholesterol', 'non hdl', 'non hdl cholesterol', 'non hdl c'],
    ['VLDL Cholesterol', 'vldl', 'vldl c', 'vldl chol'],
    ['Cholesterol/HDL Ratio', 'chol hdl ratio', 'cholesterol hdl ratio', 'tc hdl ratio', 'total cholesterol hdl ratio'],
  ],
  Liver: [
    ['AST (SGOT)', 'ast', 'sgot', 'ast sgot', 'aspartate aminotransferase', 'aspartate transaminase'],
    ['ALT (SGPT)', 'alt', 'sgpt', 'alt sgpt', 'alanine aminotransferase', 'alanine transaminase'],
    ['GGT', 'gamma gt', 'gamma glutamyl transferase', 'ggtp'],
    ['Alkaline Phosphatase', 'alp', 'alk phos', 'alkaline phosphatase'],
    ['Total Bilirubin', 'bilirubin', 'bilirubin total', 'total bilirubin', 't bili'],
    ['Direct Bilirubin', 'bilirubin direct', 'conjugated bilirubin', 'd bili'],
    ['Indirect Bilirubin', 'bilirubin indirect', 'unconjugated bilirubin'],
    ['Total Protein', 'protein total', 'serum protein', 'total protein'],
    ['Albumin', 'serum albumin'],
    ['Globulin', 'serum globulin'],
    ['A/G Ratio', 'albumin globulin ratio', 'ag ratio', 'a g ratio'],
    ['LDH', 'ld', 'lactate dehydrogenase', 'lactic dehydrogenase'],
  ],
  Kidney: [
    ['BUN', 'blood urea nitrogen', 'urea nitrogen'],
    ['Urea', 'serum urea'],
    ['Creatinine', 'creatinine enzymatic', 'serum creatinine', 'crea'],
    ['eGFR', 'egfr ckd epi', 'egfr ckd', 'gfr', 'estimated gfr', 'egfr non african american'],
    ['Cystatin C', 'cystatin'],
    ['Uric Acid', 'urate', 'serum uric acid'],
    ['BUN/Creatinine Ratio', 'bun creatinine ratio', 'urea creatinine ratio'],
  ],
  'Electrolytes & Minerals': [
    ['Sodium', 'na serum', 'serum sodium'],
    ['Potassium', 'serum potassium'],
    ['Chloride', 'serum chloride'],
    ['CO2 (Bicarbonate)', 'co2', 'bicarbonate', 'hco3', 'carbon dioxide', 'total co2'],
    ['Anion Gap'],
    ['Calcium', 'serum calcium', 'total calcium'],
    ['Ionized Calcium', 'calcium ionized', 'free calcium'],
    ['Phosphorus', 'phosphate', 'inorganic phosphorus', 'serum phosphorus'],
    ['Magnesium', 'serum magnesium'],
  ],
  'Iron Studies': [
    ['Serum Iron', 'iron', 'serum iron si', 'si'],
    ['TIBC', 'total iron binding capacity'],
    ['UIBC', 'unsaturated iron binding capacity'],
    ['Transferrin Saturation', 'transferrin sat', 'tsat', 'iron saturation', 'saturation'],
    ['Transferrin'],
    ['Ferritin', 'serum ferritin'],
  ],
  Thyroid: [
    ['TSH', 'thyroid stimulating hormone', 'thyrotropin'],
    ['Free T4', 'ft4', 'free thyroxine'],
    ['Free T3', 'ft3', 'free triiodothyronine'],
    ['T4', 'thyroxine', 'total t4'],
    ['T3', 'triiodothyronine', 'total t3'],
  ],
  Hormones: [
    ['Testosterone', 'total testosterone', 'testosterone total', 'testosterone serum'],
    ['Free Testosterone', 'testosterone free'],
    ['Estradiol', 'e2', 'oestradiol'],
    ['DHEA-S', 'dhea s', 'dheas', 'dhea sulfate', 'dehydroepiandrosterone sulfate'],
    ['Prolactin', 'prl'],
    ['Cortisol', 'serum cortisol'],
    ['LH', 'luteinizing hormone'],
    ['FSH', 'follicle stimulating hormone'],
    ['SHBG', 'sex hormone binding globulin'],
  ],
  Vitamins: [
    ['Vitamin D (25-OH)', 'vitamin d', 'vit d', '25 oh vitamin d', '25 hydroxyvitamin d', 'vitamin d 25 oh', 'vitamin d3', '25 oh d'],
    ['Vitamin B12', 'b12', 'cobalamin', 'vit b12'],
    ['Folate', 'folic acid', 'serum folate', 'vitamin b9'],
  ],
  Inflammation: [
    ['hs-CRP', 'hs crp', 'high sensitivity crp', 'high sensitivity c reactive protein'],
    ['CRP', 'c reactive protein', 'c reactive protein crp'],
    ['ESR', 'sed rate', 'erythrocyte sedimentation rate'],
    ['Homocysteine'],
  ],
  'Tumor Markers': [
    ['Total PSA', 'psa', 'psa total', 'prostate specific antigen'],
    ['Free PSA', 'psa free'],
  ],
};

export interface CanonicalMarker {
  key: string;          // stable id (normalized canonical name)
  name: string;         // canonical display name
  category: MarkerCategory;
  sort: number;         // global order: categoryIndex * 1000 + indexInCategory
}

// Normalize a raw name for matching: lowercase, punctuation → space, collapse.
// Parentheticals are kept (as words) so "Bilirubin (Direct)" ≠ "Bilirubin (Total)".
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// alias (normalized) → canonical marker
const ALIAS_MAP = new Map<string, CanonicalMarker>();

for (let ci = 0; ci < CATEGORY_ORDER.length; ci++) {
  const category = CATEGORY_ORDER[ci];
  if (category === 'Other') continue;
  const rows = REGISTRY[category];
  for (let oi = 0; oi < rows.length; oi++) {
    const [name, ...aliases] = rows[oi];
    const marker: CanonicalMarker = {
      key: normalizeName(name),
      name,
      category,
      sort: ci * 1000 + oi,
    };
    // Canonical name is always an alias, plus every listed alias.
    for (const a of [name, ...aliases]) {
      const n = normalizeName(a);
      if (!ALIAS_MAP.has(n)) ALIAS_MAP.set(n, marker);
    }
  }
}

const OTHER_SORT_BASE = (CATEGORY_ORDER.length - 1) * 1000;

/**
 * Resolve a raw lab name to its canonical marker. Unmapped names are returned
 * as an "Other" marker keeping their (trimmed) original name, sorted after all
 * known categories, alphabetically.
 */
export function canonicalize(rawName: string): CanonicalMarker {
  const n = normalizeName(rawName);
  const hit = ALIAS_MAP.get(n);
  if (hit) return hit;
  // Alphabetical-ish sort for unknowns: first char code, keeps them stable.
  const alpha = n.charCodeAt(0) || 0;
  return {
    key: n || rawName.trim().toLowerCase(),
    name: rawName.trim(),
    category: 'Other',
    sort: OTHER_SORT_BASE + Math.min(999, alpha),
  };
}

/** True when the raw name is recognised (mapped to a known canonical marker). */
export function isKnownMarker(rawName: string): boolean {
  return ALIAS_MAP.has(normalizeName(rawName));
}

// ---------------------------------------------------------------------------
// Unit reconciliation (display-only).
//
// Each marker (keyed by canonical key) may define a canonical display unit and
// a table of unit-string → factor, where  rawValue × factor = value in the
// canonical unit. Two kinds of entries:
//   • notation-equivalent (factor 1) — e.g. RBC ×10⁶/µL ≡ ×10¹²/L, same digits
//   • real conversions (factor ≠ 1)  — e.g. Glucose mmol/L × 18.016 = mg/dL
// Markers without a UnitDef fall back to "flag on differing unit strings".
//
// Stored values are NEVER rewritten — conversion happens only in the view.
// ---------------------------------------------------------------------------

export interface UnitDef {
  canonical: string;                 // pretty display unit
  factors: Record<string, number>;   // normalizeUnit(raw) → multiply factor
}

/** Normalize a unit string for matching: lowercase, drop multiply signs,
 *  carets, asterisks, spaces and dots; µ becomes u, superscripts become
 *  digits, mcg becomes ug. */
export function normalizeUnit(u: string): string {
  if (!u) return '';
  return u
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/mcg/g, 'ug')
    .replace(/⁰/g, '0').replace(/¹/g, '1').replace(/²/g, '2').replace(/³/g, '3')
    .replace(/⁴/g, '4').replace(/⁵/g, '5').replace(/⁶/g, '6').replace(/⁷/g, '7')
    .replace(/⁸/g, '8').replace(/⁹/g, '9')
    .replace(/[×x*^\s.]/g, '')
    .trim();
}

// Factors sourced from standard SI↔conventional conversion tables.
const UNIT_DEFS: Record<string, UnitDef> = {
  // Hematology
  'rbc': { canonical: '×10⁶/µL', factors: { '106/ul': 1, '1012/l': 1, 'm/ul': 1, 'mill/cumm': 1, '/ul': 1e-6, 'cells/cumm': 1e-6, '/l': 1e-12 } },
  'wbc': { canonical: '×10³/µL', factors: { '103/ul': 1, '109/l': 1, 'k/ul': 1, '/ul': 1e-3, 'cells/cumm': 1e-3, '/l': 1e-9 } },
  'platelet count': { canonical: '×10³/µL', factors: { '103/ul': 1, '109/l': 1, 'k/ul': 1, '/ul': 1e-3, 'cells/cumm': 1e-3, '/l': 1e-9 } },
  'hemoglobin': { canonical: 'g/dL', factors: { 'g/dl': 1, 'g/l': 0.1, 'mmol/l': 1.6113 } },
  'hematocrit': { canonical: '%', factors: { '%': 1, 'l/l': 100, 'ratio': 100 } },
  'mcv': { canonical: 'fL', factors: { 'fl': 1, 'um3': 1 } },
  'mch': { canonical: 'pg', factors: { 'pg': 1 } },
  'mchc': { canonical: 'g/dL', factors: { 'g/dl': 1, 'g/l': 0.1 } },
  'rdw': { canonical: '%', factors: { '%': 1 } },
  'mpv': { canonical: 'fL', factors: { 'fl': 1, 'um3': 1 } },
  // Glucose & Metabolic
  'glucose': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 18.016, 'g/l': 100 } },
  'insulin': { canonical: 'µIU/mL', factors: { 'uiu/ml': 1, 'miu/l': 1, 'pmol/l': 0.16667 } },
  // Lipids
  'total cholesterol': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 38.67, 'g/l': 100 } },
  'ldl cholesterol': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 38.67, 'g/l': 100 } },
  'hdl cholesterol': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 38.67, 'g/l': 100 } },
  'non-hdl cholesterol': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 38.67, 'g/l': 100 } },
  'vldl cholesterol': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 38.67, 'g/l': 100 } },
  'triglycerides': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 88.57, 'g/l': 100 } },
  // Liver
  'ast (sgot)': { canonical: 'U/L', factors: { 'u/l': 1, 'iu/l': 1, 'ukat/l': 60 } },
  'alt (sgpt)': { canonical: 'U/L', factors: { 'u/l': 1, 'iu/l': 1, 'ukat/l': 60 } },
  'ggt': { canonical: 'U/L', factors: { 'u/l': 1, 'iu/l': 1, 'ukat/l': 60 } },
  'alkaline phosphatase': { canonical: 'U/L', factors: { 'u/l': 1, 'iu/l': 1, 'ukat/l': 60 } },
  'ldh': { canonical: 'U/L', factors: { 'u/l': 1, 'iu/l': 1, 'ukat/l': 60 } },
  'total bilirubin': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'umol/l': 0.05847, 'mg/l': 0.1 } },
  'direct bilirubin': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'umol/l': 0.05847, 'mg/l': 0.1 } },
  'indirect bilirubin': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'umol/l': 0.05847, 'mg/l': 0.1 } },
  'total protein': { canonical: 'g/dL', factors: { 'g/dl': 1, 'g/l': 0.1 } },
  'albumin': { canonical: 'g/dL', factors: { 'g/dl': 1, 'g/l': 0.1 } },
  'globulin': { canonical: 'g/dL', factors: { 'g/dl': 1, 'g/l': 0.1 } },
  // Kidney
  'bun': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mg/l': 0.1 } },
  'creatinine': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'umol/l': 0.011312, 'mg/l': 0.1 } },
  'egfr': { canonical: 'mL/min/1.73m²', factors: { 'ml/min/173m2': 1, 'ml/min': 1, 'ml/min173m2': 1 } },
  'uric acid': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'umol/l': 0.016806, 'mg/l': 0.1 } },
  'cystatin c': { canonical: 'mg/L', factors: { 'mg/l': 1 } },
  // Electrolytes & Minerals
  'sodium': { canonical: 'mmol/L', factors: { 'mmol/l': 1, 'meq/l': 1 } },
  'potassium': { canonical: 'mmol/L', factors: { 'mmol/l': 1, 'meq/l': 1 } },
  'chloride': { canonical: 'mmol/L', factors: { 'mmol/l': 1, 'meq/l': 1 } },
  'co2 (bicarbonate)': { canonical: 'mmol/L', factors: { 'mmol/l': 1, 'meq/l': 1 } },
  'anion gap': { canonical: 'mmol/L', factors: { 'mmol/l': 1, 'meq/l': 1 } },
  'calcium': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 4.008, 'meq/l': 2.004 } },
  'phosphorus': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 3.097 } },
  'magnesium': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'mmol/l': 2.4305, 'meq/l': 1.215 } },
  // Iron Studies
  'serum iron': { canonical: 'µg/dL', factors: { 'ug/dl': 1, 'umol/l': 5.587, 'ug/l': 0.1 } },
  'tibc': { canonical: 'µg/dL', factors: { 'ug/dl': 1, 'umol/l': 5.587 } },
  'uibc': { canonical: 'µg/dL', factors: { 'ug/dl': 1, 'umol/l': 5.587 } },
  'transferrin saturation': { canonical: '%', factors: { '%': 1 } },
  'ferritin': { canonical: 'ng/mL', factors: { 'ng/ml': 1, 'ug/l': 1, 'pmol/l': 0.4451 } },
  'transferrin': { canonical: 'mg/dL', factors: { 'mg/dl': 1, 'g/l': 100 } },
  // Thyroid
  'tsh': { canonical: 'µIU/mL', factors: { 'uiu/ml': 1, 'miu/l': 1, 'uu/ml': 1 } },
  'free t4': { canonical: 'ng/dL', factors: { 'ng/dl': 1, 'pmol/l': 0.07775 } },
  'free t3': { canonical: 'pg/mL', factors: { 'pg/ml': 1, 'pmol/l': 0.651, 'ng/l': 1 } },
  't4': { canonical: 'µg/dL', factors: { 'ug/dl': 1, 'nmol/l': 0.07775 } },
  't3': { canonical: 'ng/dL', factors: { 'ng/dl': 1, 'nmol/l': 65.1 } },
  // Hormones
  'testosterone': { canonical: 'ng/dL', factors: { 'ng/dl': 1, 'nmol/l': 28.818, 'ng/ml': 100, 'ug/l': 100 } },
  'free testosterone': { canonical: 'pg/mL', factors: { 'pg/ml': 1, 'pmol/l': 0.2884, 'nmol/l': 288.4 } },
  'estradiol': { canonical: 'pg/mL', factors: { 'pg/ml': 1, 'pmol/l': 0.27241 } },
  'dhea-s': { canonical: 'µg/dL', factors: { 'ug/dl': 1, 'umol/l': 36.85 } },
  'cortisol': { canonical: 'µg/dL', factors: { 'ug/dl': 1, 'nmol/l': 0.03625 } },
  'prolactin': { canonical: 'ng/mL', factors: { 'ng/ml': 1, 'ug/l': 1 } },
  'shbg': { canonical: 'nmol/L', factors: { 'nmol/l': 1 } },
  'lh': { canonical: 'mIU/mL', factors: { 'miu/ml': 1, 'iu/l': 1 } },
  'fsh': { canonical: 'mIU/mL', factors: { 'miu/ml': 1, 'iu/l': 1 } },
  // Vitamins
  'vitamin d (25-oh)': { canonical: 'ng/mL', factors: { 'ng/ml': 1, 'nmol/l': 0.4006, 'ug/l': 1 } },
  'vitamin b12': { canonical: 'pg/mL', factors: { 'pg/ml': 1, 'pmol/l': 1.355, 'ng/l': 1 } },
  'folate': { canonical: 'ng/mL', factors: { 'ng/ml': 1, 'nmol/l': 0.4413, 'ug/l': 1 } },
  // Inflammation
  'hs-crp': { canonical: 'mg/L', factors: { 'mg/l': 1, 'mg/dl': 10, 'nmol/l': 0.10517 } },
  'crp': { canonical: 'mg/L', factors: { 'mg/l': 1, 'mg/dl': 10, 'nmol/l': 0.10517 } },
  'esr': { canonical: 'mm/hr', factors: { 'mm/hr': 1, 'mm/h': 1 } },
  'homocysteine': { canonical: 'µmol/L', factors: { 'umol/l': 1, 'mg/l': 7.397 } },
  // Tumor Markers
  'total psa': { canonical: 'ng/mL', factors: { 'ng/ml': 1, 'ug/l': 1 } },
  'free psa': { canonical: 'ng/mL', factors: { 'ng/ml': 1, 'ug/l': 1 } },
};

export function getUnitDef(markerKey: string): UnitDef | undefined {
  return UNIT_DEFS[markerKey];
}

/** Canonical display unit for a marker, or null if none defined. */
export function canonicalUnit(markerKey: string): string | null {
  return UNIT_DEFS[markerKey]?.canonical ?? null;
}

/** True when this raw unit is convertible for this marker. */
export function knownUnit(markerKey: string, rawUnit: string): boolean {
  const def = UNIT_DEFS[markerKey];
  return !!def && def.factors[normalizeUnit(rawUnit)] != null;
}

/** Convert a raw value+unit to the marker's canonical unit. Returns null when
 *  the marker has no unit def or the unit isn't recognised (caller keeps raw). */
export function convertToCanonical(markerKey: string, value: number, rawUnit: string): { value: number; unit: string } | null {
  const def = UNIT_DEFS[markerKey];
  if (!def) return null;
  const f = def.factors[normalizeUnit(rawUnit)];
  if (f == null) return null;
  return { value: value * f, unit: def.canonical };
}

/** Round a (possibly converted) value to a sensible display precision. */
export function fmtValue(x: number): number {
  const a = Math.abs(x);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
  return Number(x.toFixed(d));
}
