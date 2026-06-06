'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useRef } from 'react';
import Navigation from '@/components/Navigation';
import { getNutritionPlan, saveNutritionPlan, getDefaultNutritionPlan, getSetting, getSettingRemote, saveSetting, nutritionPlanExistsRemotely, getMeasurements } from '@/utils/storage';
import { NutritionPlan, NutritionPlanVersion, DayPlan, NutritionMeal, FoodItem, Measurement } from '@/types';
import { calcNNU, optimizeMeal, calcDailyEAA, calcGroupedEAA, calcIndividualSupplement, autoOptimize, EAA_ORDER, EAA_NAMES, MAP, TARGET_NNU, ALL_OPTIMIZER_FOODS, DEFAULT_OPTIMIZER_FOODS, isKnownFood, saveCustomFood, getCustomFoods, type AutoOptimizeResult, type SupplementGroup } from '@/utils/eaa';

// Grouping mode for EAA supplements. See state declaration in NutritionPlanPage.
type EAAGroupMode = '1' | '2-auto' | '2-manual' | 'per-meal';

// Derive the (groupCount, manualPartition) pair calcGroupedEAA needs from the
// stored mode + manual assignments. Centralised so every consumer gets the
// same answer for the same inputs.
function deriveGroupingParams(
  mode: EAAGroupMode,
  manual: Record<string, number>,
  mealNames: string[],
): { groupCount: number; manualPartition?: number[] } {
  if (mealNames.length === 0) return { groupCount: 1 };
  if (mode === '1') return { groupCount: 1 };
  if (mode === 'per-meal') return { groupCount: mealNames.length };
  if (mode === '2-manual') {
    // Fallback: if a meal isn't yet assigned, split in half by index order.
    const half = Math.floor(mealNames.length / 2);
    const partition = mealNames.map((n, i) => manual[n] ?? (i < half ? 0 : 1));
    return { groupCount: 2, manualPartition: partition };
  }
  return { groupCount: 2 };
}
import { FOODS } from '@/utils/foods';
import { calcDerivedTDEE, calcWeeklyIntake, calcRecommendedMacros } from '@/utils/calories';

type Phase = 'bulking' | 'cutting';

// Derived view of FOODS — single source of truth lives in src/utils/foods.ts.
const FOOD_DB: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = Object.fromEntries(
  Object.entries(FOODS).map(([k, f]) => [k, { kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat }])
);

// Supplements: fixed macros per serving (not per 100g)
// Oils (krill / omega-3 / fish oil) are PER-GRAM values — they scale with the
// dosage parsed from the item string. e.g. "Omega 3 2000mg" → 2g fat / 18 kcal.
const SUPPLEMENT_DB: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = {
  'krill oil': { kcal: 9, protein: 0, carbs: 0, fat: 1 },
  'omega 3': { kcal: 9, protein: 0, carbs: 0, fat: 1 },
  'omega3': { kcal: 9, protein: 0, carbs: 0, fat: 1 },
  'fish oil': { kcal: 9, protein: 0, carbs: 0, fat: 1 },
  'd3': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'd3+k2': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'vitamin d': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'vitamin c': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'zinc': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'magnesium': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'creatine': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'glutamine': { kcal: 4, protein: 1, carbs: 0, fat: 0 },
  'bcaa': { kcal: 4, protein: 1, carbs: 0, fat: 0 },
  'eaa': { kcal: 4, protein: 1, carbs: 0, fat: 0 },
  'multivitamin': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'ashwagandha': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'melatonin': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'probiotics': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  // Per-gram values (see SUPPLEMENT_PER_GRAM below) — scaled by parsed amount
  'collagen': { kcal: 3.6, protein: 0.9, carbs: 0, fat: 0 },
  'biotin': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'iron': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'calcium': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'tudca': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'nac': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'coq10': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'greens superfood': { kcal: 10, protein: 1, carbs: 2, fat: 0 },
  'greens': { kcal: 10, protein: 1, carbs: 2, fat: 0 },
  'apple vinegar': { kcal: 1, protein: 0, carbs: 0, fat: 0 },
  'apple cider vinegar': { kcal: 1, protein: 0, carbs: 0, fat: 0 },
  'lemon juice': { kcal: 3, protein: 0, carbs: 1, fat: 0 },
  'beta alanine': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'sea salt': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'salt': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'maltodextrin': { kcal: 3.8, protein: 0, carbs: 0.95, fat: 0 },
  'dextrose': { kcal: 4, protein: 0, carbs: 1, fat: 0 },
  'cluster dextrin': { kcal: 3.8, protein: 0, carbs: 0.95, fat: 0 },
  'citrulline': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'caffeine': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'taurine': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'dim': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'zinc citrate': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'calcium carbonate': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'magnesium oxide': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'vitamin e': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'vitamin b': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'vitamin b complex': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'tongkat ali': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'thongkat ali': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
};

// Shared style/label for the Print buttons (EAA panel + meal plan card)
const PRINT_BTN_CLASS = "text-[10px] uppercase tracking-wider text-cyan-400/70 hover:text-cyan-300 transition-colors px-2.5 py-1 rounded border border-cyan-400/25 hover:border-cyan-400/50 hover:bg-cyan-400/5";

// Build an A4 print document that auto-shrinks content to fit a single page.
function buildA4PrintDoc(opts: { title: string; bodyHtml: string; extraCss?: string }): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${opts.title}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { width: 210mm; height: 297mm; padding: 12mm 14mm; overflow: hidden; position: relative; }
  .page-content { transform-origin: top left; width: 100%; }
  ${opts.extraCss || ''}
</style></head>
<body>
  <div class="page"><div class="page-content">${opts.bodyHtml}</div></div>
  <script>
    window.addEventListener('load', function () {
      var page = document.querySelector('.page');
      var content = document.querySelector('.page-content');
      // Available area inside .page padding (12mm top/bottom, 14mm left/right)
      var pxPerMm = 96 / 25.4;
      var availH = page.clientHeight - 24 * pxPerMm;
      var availW = page.clientWidth - 28 * pxPerMm;
      // Iteratively scale because scaling can change wrapping slightly
      var scale = 1;
      for (var i = 0; i < 4; i++) {
        var ch = content.scrollHeight;
        var cw = content.scrollWidth;
        if (ch <= availH && cw <= availW) break;
        var s = Math.min(availH / ch, availW / cw);
        scale = scale * s * 0.995; // tiny safety margin to avoid edge clipping
        content.style.transform = 'scale(' + scale + ')';
        content.style.width = (100 / scale) + '%';
      }
      setTimeout(function () { window.print(); }, 200);
    });
  <\/script>
</body></html>`;
}

function openPrintWindow(html: string) {
  // Use a hidden iframe instead of window.open. In an iOS standalone PWA a
  // popup is opened in Safari, and after the print dialog closes the user
  // is stuck there — the PWA has to be killed from the app switcher to come
  // back. Printing from an in-page iframe keeps the user inside the PWA.
  const prev = document.getElementById('print-iframe');
  if (prev) prev.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'print-iframe';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed; left:-10000px; top:0; width:210mm; height:297mm; border:0; visibility:hidden;';
  document.body.appendChild(iframe);
  const cleanup = () => { try { iframe.remove(); } catch {} window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60000); // safety fallback if afterprint never fires
  iframe.srcdoc = html;
}

function lookupFood(name: string): { kcal: number; protein: number; carbs: number; fat: number } | null {
  const key = name.toLowerCase().trim();
  // Check custom foods first
  const custom = getCustomFoods();
  if (custom[key]) return { kcal: custom[key].kcal, protein: custom[key].protein, carbs: custom[key].carbs, fat: custom[key].fat };
  for (const [ck, food] of Object.entries(custom)) {
    if (key.includes(ck) || ck.includes(key)) return { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat };
  }
  // Built-in DB
  if (FOOD_DB[key]) return FOOD_DB[key];
  let bestKey = '';
  let bestVal: { kcal: number; protein: number; carbs: number; fat: number } | null = null;
  for (const [dbKey, val] of Object.entries(FOOD_DB)) {
    if ((key.includes(dbKey) || dbKey.includes(key)) && dbKey.length > bestKey.length) {
      bestKey = dbKey;
      bestVal = val;
    }
  }
  return bestVal;
}

// Weight per piece for countable foods (grams per 1 unit)
const PIECE_WEIGHTS: Record<string, number> = {
  'egg': 60,
  'eggs': 60,
  'egg whites': 33,
  'banana': 120,
  'avocado': 150,
  'bagel': 100,
  'tortilla': 45,
  'rice cakes': 9,
  'rice cake': 9,
  'protein bar': 60,
  'apple': 180,
  'orange': 150,
};

function getPieceWeight(name: string): number | null {
  const lower = name.toLowerCase().trim();
  if (PIECE_WEIGHTS[lower]) return PIECE_WEIGHTS[lower];
  for (const [key, weight] of Object.entries(PIECE_WEIGHTS)) {
    if (lower.includes(key) || key.includes(lower)) return weight;
  }
  return null;
}

function parseGrams(amount: string | undefined, foodName: string): number | null {
  if (!amount) return null;
  const safe = (s: string, fb = 0) => { const v = parseFloat(s); return isFinite(v) ? v : fb; };
  // Explicit gram unit
  const gMatch = amount.match(/([\d.]+)\s*(?:gr|g|grams?)$/i);
  if (gMatch) return safe(gMatch[1]);
  // Explicit ml (treat as grams for liquids)
  const mlMatch = amount.match(/([\d.]+)\s*ml$/i);
  if (mlMatch) return safe(mlMatch[1]);
  // Cups (1 cup ≈ 240ml for liquids, 150g for solids)
  const cupMatch = amount.match(/([\d.]*)\s*cups?$/i);
  if (cupMatch) {
    const count = safe(cupMatch[1] || '1', 1);
    return count * 240;
  }
  // Tablespoon / teaspoon
  const tbspMatch = amount.match(/([\d.]+)\s*(?:tbsp|tablespoons?)$/i);
  if (tbspMatch) return safe(tbspMatch[1]) * 15;
  const tspMatch = amount.match(/([\d.]+)\s*(?:tsp|teaspoons?)$/i);
  if (tspMatch) return safe(tspMatch[1]) * 5;
  // Scoop (assume ~30g per scoop for protein powder)
  const scoopMatch = amount.match(/([\d.]*)\s*scoops?$/i);
  if (scoopMatch) return safe(scoopMatch[1] || '1', 1) * 30;
  // Bare number — check if this food is countable (pieces)
  const bare = amount.match(/^([\d.]+)$/);
  if (bare) {
    const count = safe(bare[1]);
    const pieceWeight = getPieceWeight(foodName);
    if (pieceWeight) return count * pieceWeight;
    // Not a known countable food — assume grams
    return count;
  }
  return null;
}

function calcItemMacros(item: FoodItem): FoodItem {
  const db = lookupFood(item.name);
  if (db) {
    const grams = parseGrams(item.amount, item.name);
    if (grams == null) return item;
    const factor = grams / 100;
    return {
      ...item,
      kcal: Math.round(db.kcal * factor),
      protein: Math.round(db.protein * factor * 10) / 10,
      carbs: Math.round(db.carbs * factor * 10) / 10,
      fat: Math.round(db.fat * factor * 10) / 10,
    };
  }
  // Try supplement DB (fixed per-serving macros)
  const sup = lookupSupplement(item.name);
  if (sup) {
    return { ...item, kcal: sup.kcal, protein: sup.protein, carbs: sup.carbs, fat: sup.fat };
  }
  return item;
}

// Supplements where macros scale with the parsed amount (DB values are per 1g).
// Oils are mostly fat — 9 kcal/g, 1g fat per gram of oil.
const SUPPLEMENT_PER_GRAM = new Set([
  'maltodextrin', 'dextrose', 'cluster dextrin',
  'bcaa', 'eaa', 'glutamine', 'collagen',
  'krill oil', 'omega 3', 'omega3', 'fish oil',
]);

function lookupSupplement(name: string): { kcal: number; protein: number; carbs: number; fat: number } | null {
  const key = name.toLowerCase().trim();
  // Strip dosage from the end: "Krill oil 500mg" -> "krill oil"
  const stripped = key.replace(/\s+\d[\d.,]*\s*(?:mg|gr?|iu|mcg|ml|caps?|tablets?|scoops?)\s*$/i, '').trim();

  let macros: { kcal: number; protein: number; carbs: number; fat: number } | null = null;
  let matchedKey: string | null = null;
  if (SUPPLEMENT_DB[stripped]) { macros = SUPPLEMENT_DB[stripped]; matchedKey = stripped; }
  else {
    for (const [dbKey, val] of Object.entries(SUPPLEMENT_DB)) {
      if (stripped.includes(dbKey) || dbKey.includes(stripped)) { macros = val; matchedKey = dbKey; break; }
    }
  }
  if (!macros || !matchedKey) return null;

  // For per-gram supplements, scale by the parsed amount.
  // Accept both `g` (grams) and `mg` (milligrams, divided by 1000).
  // Check `mg` first — `g`-pattern won't match "500mg" (m before g) but order
  // is the safe choice.
  if (SUPPLEMENT_PER_GRAM.has(matchedKey)) {
    const mgMatch = key.match(/(\d[\d.]*)\s*mg\b/i);
    const gMatch = !mgMatch ? key.match(/(\d[\d.]*)\s*g(?:r|ram)?s?\b/i) : null;
    let grams = 0;
    if (mgMatch) grams = parseFloat(mgMatch[1]) / 1000;
    else if (gMatch) grams = parseFloat(gMatch[1]);
    if (isFinite(grams) && grams > 0) {
      return {
        kcal: Math.round(macros.kcal * grams),
        protein: Math.round(macros.protein * grams * 10) / 10,
        carbs: Math.round(macros.carbs * grams * 10) / 10,
        fat: Math.round(macros.fat * grams * 10) / 10,
      };
    }
  }
  return macros;
}

function sumMacros(meals: NutritionMeal[]): { kcal: number; protein: number; carbs: number; fat: number } {
  let kcal = 0, protein = 0, carbs = 0, fat = 0;
  for (const meal of meals) {
    for (const rawItem of meal.items) {
      const computed = calcItemMacros(parseFoodItem(rawItem));
      kcal += computed.kcal || 0;
      protein += computed.protein || 0;
      carbs += computed.carbs || 0;
      fat += computed.fat || 0;
    }
    for (const sup of meal.supplements || []) {
      const sm = lookupSupplement(sup);
      if (sm) {
        kcal += sm.kcal;
        protein += sm.protein;
        carbs += sm.carbs;
        fat += sm.fat;
      }
    }
  }
  return { kcal: Math.round(kcal), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

function MacroBar({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-sm font-bold text-white">{value}</span>
      <span className="text-[10px] text-white/30">{unit}</span>
    </div>
  );
}

function parseSupplement(sup: string): { name: string; amount: string } {
  const m = sup.match(/^(.+?)\s+(\d[\d.,]*\s*(?:mg|gr?|iu|mcg|ml|caps?|tablets?|scoops?).*)$/i);
  if (m) return { name: m[1], amount: m[2] };
  return { name: sup, amount: '' };
}

function joinSupplement(name: string, amount: string): string {
  return amount.trim() ? `${name.trim()} ${amount.trim()}` : name.trim();
}

function parseFoodItem(item: FoodItem | string): FoodItem {
  let parsed: FoodItem;
  if (typeof item === 'string') {
    // Legacy format: "Greek yogurt 250" or "Greek yogurt 250 gr"
    const matchWithUnit = item.match(/^(.+?)\s+(\d[\d.]*\s*(?:gr|g|mg|ml|iu|scoop).*)$/i);
    if (matchWithUnit) { parsed = { name: matchWithUnit[1], amount: matchWithUnit[2] }; }
    else {
      // Bare number at end — keep as-is (could be pieces or grams)
      const matchBare = item.match(/^(.+?)\s+(\d[\d.]*)$/);
      if (matchBare) { parsed = { name: matchBare[1], amount: matchBare[2] }; }
      else { parsed = { name: item }; }
    }
  } else {
    // Already a FoodItem — keep bare numbers as-is
    if (item.amount) {
      parsed = { ...item };
    } else {
      parsed = { ...item };
    }
  }
  return calcItemMacros(parsed);
}

function MealCard({ meal, allowedFoods, onSaveOptimized, avgTargets, dailyEAAPerMeal, woSupplement }: {
  meal: NutritionMeal;
  allowedFoods?: string[];
  onSaveOptimized?: (meal: NutritionMeal) => void;
  avgTargets?: { kcal: number; protein: number; carbs: number; fat: number };
  dailyEAAPerMeal?: { aa: string; mg: number }[];
  woSupplement?: { aas: { aa: string; mg: number }[]; totalMg: number; foodNNU: number; finalNNU: number } | null;
}) {
  const [showNNU, setShowNNU] = useState(false);
  const [level, setLevel] = useState(2);

  const backupKey = `nnu_backup_${meal.name}`;
  const hasBackup = typeof window !== 'undefined' && !!localStorage.getItem(backupKey);

  // Skip NNU for workout/intra meals (only supplements, no real food)
  const isWorkoutMeal = meal.name.toLowerCase().includes('during workout') || meal.name.toLowerCase().includes('intra');

  // Per-meal macros and NNU (lazy — only if items exist)
  const mealMacros = sumMacros([meal]);
  const parsedFoods = meal.items.map(it => { try { return parseFoodItem(it); } catch { return { name: '' }; } }).filter(it => it.name.trim() && it.amount);
  const foodInputs = parsedFoods.map(f => ({ name: f.name, amount: f.amount }));
  const nnu = !isWorkoutMeal && parsedFoods.length > 0 ? calcNNU(foodInputs) : null;

  // Compute NNU with EAA supplement — use individual for After WO, avg for others
  const isAfterWO = meal.name.toLowerCase().includes('after workout');
  let nnuWithEAA: number | null = null;
  if (nnu) {
    // Use live data from props (not stale localStorage). After WO uses its
    // individual supplement, all other meals use the daily-EAA per-meal split.
    const eaaData: { aa: string; mg: number }[] = isAfterWO
      ? (woSupplement?.aas || [])
      : (dailyEAAPerMeal || []);
    if (eaaData.length > 0) {
      const p = { ...nnu.profile };
      for (const s of eaaData) {
        const k = s.aa as keyof typeof p;
        if (p[k] !== undefined) p[k] += s.mg;
      }
      const t = EAA_ORDER.reduce((sum, aa) => sum + p[aa], 0);
      let minR = Infinity;
      for (const aa of EAA_ORDER) { const r = (p[aa] / t * 100) / MAP[aa]; if (r < minR) minR = r; }
      nnuWithEAA = Math.round(minR * 1000) / 10;
    }
  }

  const [optimization, setOptimization] = useState<ReturnType<typeof optimizeMeal>>(null);
  const [lookingUp, setLookingUp] = useState<string | null>(null);

  // Clear stale optimization when meal items change
  const mealItemsKey = JSON.stringify(meal.items);
  useEffect(() => { setOptimization(null); }, [mealItemsKey]);

  const lookupUnknownFood = async (foodName: string) => {
    setLookingUp(foodName);
    try {
      const res = await fetch('/api/food-lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ food: foodName }) });
      const data = await res.json();
      if (!res.ok) { console.error('Food lookup error:', data.error); setLookingUp(null); return; }
      saveCustomFood({ name: data.name || foodName.toLowerCase(), kcal: data.kcal, protein: data.protein, carbs: data.carbs, fat: data.fat, eaa: data.eaa });
    } catch (e) { console.error('Food lookup failed:', e); }
    setLookingUp(null);
  };

  // Recompute optimization — runs in setTimeout to not block UI
  const [optimizing, setOptimizing] = useState(false);
  const computeOptimization = (lvl?: number) => {
    if (!nnu || nnu.nnu >= 95) return;
    // After Workout uses an EAA supplement only — skip the food optimizer.
    if (isAfterWO) return;
    const useLevel = lvl ?? level;
    setOptimizing(true);
    setOptimization(null);
    setTimeout(() => {
      try {
        const result = optimizeMeal(foodInputs, TARGET_NNU, allowedFoods, useLevel);
        setOptimization(result);
      } catch { setOptimization(null); }
      setOptimizing(false);
    }, 50);
  };

  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div>
          <span className="text-sm font-semibold text-white">{meal.name}</span>
          {meal.subtitle && <span className="text-xs text-white/30 ml-2">({meal.subtitle})</span>}
        </div>
        {nnu && (
          <button onClick={() => { const next = !showNNU; setShowNNU(next); if (next) computeOptimization(); }}
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${nnu.nnu >= 95 ? 'bg-green-500/15 text-green-400' : nnu.nnu >= 80 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400'}`}>
            NNU {nnu.nnu}%
            <span className={nnuWithEAA != null && nnuWithEAA > nnu.nnu ? (isAfterWO ? ' text-amber-400/70' : ' text-cyan-400/70') : ' text-white/40'}> → {nnuWithEAA != null ? nnuWithEAA : nnu.nnu}%</span>
          </button>
        )}
      </div>
      {/* Per-meal macros + delta vs average */}
      <div className="flex gap-4 mb-2">
        {[
          { label: 'Kcal', val: mealMacros.kcal, avg: avgTargets?.kcal },
          { label: 'Protein', val: mealMacros.protein, avg: avgTargets?.protein, unit: 'g' },
          { label: 'Carbs', val: mealMacros.carbs, avg: avgTargets?.carbs, unit: 'g' },
          { label: 'Fat', val: mealMacros.fat, avg: avgTargets?.fat, unit: 'g' },
        ].map(m => {
          const hasTarget = m.avg != null;
          const delta = hasTarget ? m.val - (m.avg as number) : 0;
          return (
            <div key={m.label}>
              <span className="text-xs text-white/50 font-semibold">{m.val}</span>
              {m.unit && <span className="text-[10px] text-white/40 ml-0.5">{m.unit}</span>}
              <span className="text-[10px] text-white/25 ml-0.5">{m.label}</span>
              {hasTarget && delta !== 0 && (
                <span className={`text-[10px] ml-1 ${delta > 0 ? 'text-red-400/50' : 'text-green-400/50'}`}>{delta > 0 ? '+' : ''}{Math.round(delta)}</span>
              )}
              {hasTarget && delta === 0 && (
                <span className="text-[10px] ml-1 text-green-400/50">✓</span>
              )}
            </div>
          );
        })}
      </div>
      {meal.items.length > 0 && (
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col />
            <col style={{ width: '80px' }} />
            <col style={{ width: '160px' }} />
          </colgroup>
          <tbody>
            {meal.items.map((rawItem, i) => {
              const item = calcItemMacros(parseFoodItem(rawItem));
              const hasMacros = item.kcal != null && item.kcal > 0;
              const unknown = item.name.trim() && !isKnownFood(item.name);
              return (
                <tr key={i} className="text-sm">
                  <td className="py-0.5 pr-4">
                    <span className={unknown ? 'text-red-400/60' : 'text-white/60'}>
                      {item.leading && <span className="text-amber-400 mr-1 text-xs">★</span>}
                      {item.name}
                    </span>
                    {unknown && (
                      lookingUp === item.name
                        ? <span className="text-[9px] text-white/30 ml-2">looking up...</span>
                        : <button onClick={() => lookupUnknownFood(item.name)} className="text-[9px] text-cyan-400/60 hover:text-cyan-400 ml-2">look up</button>
                    )}
                  </td>
                  <td className="py-0.5 text-white/40 text-right whitespace-nowrap font-mono text-xs">{item.amount || ''}</td>
                  <td className="py-0.5 text-right whitespace-nowrap pl-3">
                    {hasMacros && (
                      <span className="text-[10px] text-white/25">
                        {item.kcal} · {item.protein}p · {item.carbs}c · {item.fat}f
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {meal.supplements && meal.supplements.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/5">
          {meal.supplements.map((s, i) => {
            const sm = lookupSupplement(s);
            const hasMacros = sm && (sm.kcal > 0 || sm.fat > 0 || sm.protein > 0);
            return (
              <div key={i} className="flex items-baseline justify-between">
                <span className="text-[11px] text-amber-400/50">+ {s}</span>
                {hasMacros && (
                  <span className="text-[10px] text-white/25">
                    {sm.kcal} · {sm.protein}p · {sm.carbs}c · {sm.fat}f
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* NNU Analysis Panel */}
      {showNNU && nnu && (
        <div className="mt-3 p-3 rounded-xl bg-white/5 border border-white/5">
          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Amino Acid Profile</div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs mb-2">
            {EAA_ORDER.map(aa => {
              const pct = nnu.pcts[aa];
              const target = MAP[aa];
              const isLimiting = aa === nnu.limiting;
              const isLow = pct < target * 0.95;
              return (
                <div key={aa} className={`flex justify-between ${isLimiting ? 'text-red-400 font-bold' : isLow ? 'text-yellow-400/70' : 'text-white/40'}`}>
                  <span>{EAA_NAMES[aa]}</span>
                  <span>{pct.toFixed(1)}% <span className="text-white/20">/ {target}%</span></span>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-white/30 mb-1">{nnu.totalProtein}g protein · {nnu.usedProtein}g used · {nnu.wastedProtein}g wasted</div>

          {/* After Workout: show ONLY the EAA supplement table (food optimizer
              would suggest changing the post-workout drink, which Mark doesn't
              want — this meal is supplement-driven by design) */}
          {isAfterWO && woSupplement && (
            <div className="mt-3 p-3 rounded-lg bg-amber-500/8 border border-amber-500/15">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-sm font-semibold text-amber-400">+ Individual EAA supplement</span>
                <span className="text-xs text-white/40">
                  NNU {woSupplement.foodNNU}% → <span className="text-amber-300 font-bold">{woSupplement.finalNNU}%</span>
                  <span className="text-white/30 ml-2">{(woSupplement.totalMg / 1000).toFixed(1)}g total</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {woSupplement.aas.map((s, i) => (
                  <div key={i} className="text-xs flex justify-between">
                    <span className="text-amber-400/70">{EAA_NAMES[s.aa as keyof typeof EAA_NAMES] || s.aa}</span>
                    <span className="text-white/50 font-mono">{s.mg}mg</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-white/5 text-[10px] text-white/30">
                Mix into the post-workout drink. No food changes recommended for this meal.
              </div>
            </div>
          )}

          {/* Aggressiveness slider — only for non-After-Workout meals */}
          {nnu && nnu.nnu < 95 && !isAfterWO && (
            <div className="mt-3 mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">Optimization Level</span>
                <span className="text-[10px] text-white/40">{['Conservative', 'Moderate', 'Aggressive', 'Very Aggressive', 'Extreme'][level - 1]}</span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(l => (
                  <button key={l} onClick={() => { setLevel(l); computeOptimization(l); }}
                    className={`flex-1 h-6 rounded-lg transition-all flex items-center justify-center text-[9px] font-bold ${l <= level ? 'bg-green-400/60 text-white/70' : 'bg-white/10 text-white/20'}`}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {/* Optimization suggestion */}
          {optimizing && <div className="mt-2 text-xs text-white/30">Optimizing...</div>}
          {optimization && !optimizing && (
            <div className="mt-2 p-3 rounded-lg bg-green-500/8 border border-green-500/15">
              {/* NNU headline — food only */}
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-lg font-bold text-green-400">NNU {optimization.foodOnlyNNU}%</span>
                <span className="text-xs text-white/20">from {optimization.originalNNU}%</span>
              </div>
              {/* Macro deltas */}
              <div className="flex gap-3 mb-3 text-[11px]">
                <span className={optimization.deltaKcal >= 0 ? 'text-white/40' : 'text-green-400/60'}>{optimization.deltaKcal > 0 ? '+' : ''}{optimization.deltaKcal} kcal</span>
                <span className={optimization.deltaProtein >= 0 ? 'text-blue-400/60' : 'text-white/40'}>{optimization.deltaProtein > 0 ? '+' : ''}{optimization.deltaProtein}g protein</span>
                <span className="text-yellow-400/40">{optimization.deltaCarbs > 0 ? '+' : ''}{optimization.deltaCarbs}g carbs</span>
                <span className="text-green-600/40">{optimization.deltaFat > 0 ? '+' : ''}{optimization.deltaFat}g fat</span>
              </div>

              {/* Food changes */}
              {optimization.changes.length > 0 && (
                <div className="mb-2">
                  {optimization.changes.map((c, i) => (
                    <div key={i} className="text-xs flex justify-between">
                      <span className="text-yellow-400/70">{c.food.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}</span>
                      <span className="text-white/30">{c.originalG}g → <span className="text-yellow-400/70">{c.newG}g</span></span>
                    </div>
                  ))}
                </div>
              )}

              {/* Food additions */}
              {optimization.additions.length > 0 && (
                <div className="mb-2">
                  {optimization.additions.map((a, i) => (
                    <div key={i} className="text-xs flex justify-between">
                      <span className="text-green-400">+ {a.food.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}</span>
                      <span className="text-green-400/60">{a.grams}g (+{a.kcal} kcal)</span>
                    </div>
                  ))}
                </div>
              )}

              {/* EAA supplement per meal — individual for After WO, avg for others */}
              {(() => {
                const supData: { aa: string; mg: number }[] = (() => {
                  if (typeof window === 'undefined') return [];
                  if (isAfterWO) {
                    try { const wo = JSON.parse(localStorage.getItem('eaa_wo_supplement') || 'null'); return wo?.aas || []; } catch { return []; }
                  }
                  if (dailyEAAPerMeal && dailyEAAPerMeal.length > 0) return dailyEAAPerMeal;
                  try { return JSON.parse(localStorage.getItem('eaa_per_meal') || '[]'); } catch { return []; }
                })();
                if (supData.length === 0) return null;
                return (
                  <div className="pt-2 border-t border-white/5">
                    <div className={`text-[10px] uppercase mb-1 ${isAfterWO ? 'text-amber-400/40' : 'text-white/25'}`}>
                      + {isAfterWO ? 'Individual' : 'Daily avg'} EAA supplement
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      {supData.map((s, i) => (
                        <div key={i} className="text-xs flex justify-between">
                          <span className={isAfterWO ? 'text-amber-400/60' : 'text-cyan-400/60'}>{EAA_NAMES[s.aa as keyof typeof EAA_NAMES] || s.aa}</span>
                          <span className="text-white/40 font-mono">{s.mg}mg</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Apply / Undo buttons */}
              {onSaveOptimized && (
                <button
                  onClick={() => {
                    // Backup original meal before applying
                    try { localStorage.setItem(backupKey, JSON.stringify(meal)); } catch {}
                    const newItems = [...meal.items].map(rawItem => {
                      const item = parseFoodItem(rawItem);
                      const change = optimization.changes.find(c => item.name.toLowerCase().includes(c.food) || c.food.includes(item.name.toLowerCase()));
                      if (change) return { ...item, amount: `${change.newG} gr` };
                      return item;
                    });
                    for (const a of optimization.additions) {
                      newItems.push({ name: a.food.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), amount: `${a.grams} gr` });
                    }
                    onSaveOptimized({ ...meal, items: newItems });
                  }}
                  className="mt-3 w-full text-xs font-bold text-green-400 bg-green-500/15 hover:bg-green-500/25 py-2 rounded-lg transition-all uppercase tracking-wider"
                >
                  Apply Changes
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Undo optimization button */}
      {hasBackup && onSaveOptimized && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => {
              try {
                const backup = JSON.parse(localStorage.getItem(backupKey)!);
                localStorage.removeItem(backupKey);
                onSaveOptimized(backup);
              } catch {}
            }}
            className="text-[10px] text-red-400/50 hover:text-red-400 uppercase tracking-wider"
          >
            Undo Optimization
          </button>
        </div>
      )}
    </div>
  );
}

function AutoOptimizePanel({ plan, allowedFoods, persist }: { plan: NutritionPlan; allowedFoods: string[]; persist: (p: NutritionPlan) => Promise<void> }) {
  const [result, setResult] = useState<AutoOptimizeResult | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [level, setLevel] = useState(3);

  const [roundProgress, setRoundProgress] = useState(0);
  const [totalRounds, setTotalRounds] = useState(5);

  // Track mount state so async setTimeouts don't update unmounted component
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const safeSet = <T,>(setter: (v: T) => void) => (v: T) => { if (mountedRef.current) setter(v); };
  const setRunningSafe = safeSet(setRunning);
  const setResultSafe = safeSet(setResult);
  const setProgressSafe = safeSet(setProgress);
  const setRoundProgressSafe = safeSet(setRoundProgress);

  const run = () => {
    setRunningSafe(true);
    setResultSafe(null);
    setRoundProgressSafe(0);
    setProgressSafe('Preparing...');

    // Run 1 round per setTimeout so UI can update between rounds
    setTimeout(() => {
      if (!mountedRef.current) return;
      const isExcluded = (n: string) => { const l = n.toLowerCase(); return l.includes('during workout') || l.includes('intra') || l.includes('after workout'); };
      const mainMeals = plan.current.trainingDay.meals.filter(m => !isExcluded(m.name));
      const mealFoods: { name: string; amount?: string }[][] = mainMeals.map(m =>
        m.items.map(it => { try { return parseFoodItem(it); } catch { return { name: '' }; } })
          .filter(it => it.name.trim() && it.amount)
          .map(f => ({ name: f.name, amount: f.amount }))
      );

      const maxR = 5;
      let round = 0;
      const runRound = () => {
        if (!mountedRef.current) return;
        setRoundProgressSafe(round + 1);
        setProgressSafe(`Round ${round + 1}/${maxR}...`);
        setTimeout(() => {
          if (!mountedRef.current) return;
          const res = autoOptimize(mealFoods, allowedFoods, level, round + 1);
          if (res.finalMeals.length > 0) {
            for (let i = 0; i < mealFoods.length; i++) {
              if (res.finalMeals[i]) mealFoods[i] = res.finalMeals[i];
            }
          }
          round++;
          if (round >= maxR || (round > 1 && res.rounds.length > 0 && res.rounds[res.rounds.length - 1].withEAANNU === res.rounds[Math.max(0, res.rounds.length - 2)]?.withEAANNU)) {
            setResultSafe(res);
            setRunningSafe(false);
            setProgressSafe('');
          } else {
            runRound();
          }
        }, 50);
      };
      runRound();
    }, 50);
  };

  const applyAll = async () => {
    if (!result) return;

    // Save current plan to history first (protection)
    const archived = { ...plan.current, endDate: new Date().toISOString().split('T')[0] };
    const newHistory = [archived, ...(plan.history || [])];

    // Save per-meal backups for undo (localStorage)
    const isExcluded = (n: string) => { const l = n.toLowerCase(); return l.includes('during workout') || l.includes('intra') || l.includes('after workout'); };
    for (const meal of plan.current.trainingDay.meals) {
      if (!isExcluded(meal.name)) {
        try { localStorage.setItem(`nnu_backup_${meal.name}`, JSON.stringify(meal)); } catch {}
      }
    }

    const mainMealIndices = plan.current.trainingDay.meals.map((m, i) => ({ m, i })).filter(({ m }) => !isExcluded(m.name));

    const newMeals = plan.current.trainingDay.meals.map((meal, i) => {
      const mainIdx = mainMealIndices.findIndex(({ i: mi }) => mi === i);
      if (mainIdx === -1 || !result.finalMeals[mainIdx]) return meal;
      return {
        ...meal,
        items: result.finalMeals[mainIdx].map(f => ({ name: f.name, amount: f.amount })),
      };
    });

    const newMacros = sumMacros(newMeals.map(m => ({ ...m, items: m.items.map(it => parseFoodItem(it)) })));

    // Write EAA data BEFORE persist so persist's macro recompute picks up the new EAA values
    if (result.finalSupplement) {
      try {
        const eaaGStr = String(result.finalSupplement.totalPerDay / 1000);
        const perMealStr = JSON.stringify(result.finalSupplement.perMeal);
        localStorage.setItem('eaa_daily_result', JSON.stringify(result.finalSupplement));
        localStorage.setItem('eaa_g_per_day', eaaGStr);
        localStorage.setItem('eaa_per_meal', perMealStr);
        // Sync to Firestore for cross-device consistency
        saveSetting('eaa_g_per_day', eaaGStr);
        saveSetting('eaa_per_meal', perMealStr);
      } catch {}
    }

    await persist({
      current: {
        ...plan.current,
        id: Date.now().toString(),
        startDate: new Date().toISOString().split('T')[0],
        trainingDay: { ...plan.current.trainingDay, meals: newMeals, macros: newMacros },
      },
      history: newHistory,
    });

    setResult(null);
  };

  return (
    <div className="mb-6 glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">Auto-Optimize NNU</h3>
        <div className="flex items-center gap-2">
          {/* Level selector */}
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(l => (
              <button key={l} onClick={() => setLevel(l)}
                className={`w-5 h-5 rounded text-[8px] font-bold ${l <= level ? 'bg-purple-500/50 text-white/70' : 'bg-white/5 text-white/20'}`}>{l}</button>
            ))}
          </div>
          <button onClick={run} disabled={running}
            className="text-[10px] font-bold text-purple-400 bg-purple-500/15 hover:bg-purple-500/25 px-3 py-1.5 rounded-lg transition-all uppercase tracking-wider disabled:opacity-30">
            {running ? progress : 'Optimize'}
          </button>
        </div>
      </div>

      {/* Progress bar while computing */}
      {running && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-purple-400/60">{progress}</span>
            <span className="text-[10px] text-white/20">Round {roundProgress}/5</span>
          </div>
          <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500/60 rounded-full transition-all duration-300" style={{ width: `${Math.max(10, roundProgress * 20)}%` }} />
          </div>
        </div>
      )}

      {result && (() => {
        const isExcluded = (n: string) => { const l = n.toLowerCase(); return l.includes('during workout') || l.includes('intra') || l.includes('after workout'); };
        const mainMeals = plan.current.trainingDay.meals.filter(m => !isExcluded(m.name));
        const sup = result.finalSupplement;

        // Compute total macros from optimized plan + EAA
        const allOptMeals = plan.current.trainingDay.meals.map((meal, i) => {
          const mainIdx = mainMeals.findIndex(m => m.name === meal.name);
          if (mainIdx === -1 || !result.finalMeals[mainIdx]) return meal;
          return { ...meal, items: result.finalMeals[mainIdx].map(f => ({ name: f.name, amount: f.amount })) };
        });
        const optFoodMacros = sumMacros(allOptMeals);
        const optEaaG = sup ? sup.totalPerDay / 1000 : 0;
        const optMacros = {
          kcal: optFoodMacros.kcal + Math.round(optEaaG * 4),
          protein: optFoodMacros.protein + Math.round(optEaaG),
          carbs: optFoodMacros.carbs,
          fat: optFoodMacros.fat,
        };

        // Read targets
        const tgts: { kcal: number; protein: number; carbs: number; fat: number } = (() => {
          try { const s = localStorage.getItem('macro_targets'); if (s) return JSON.parse(s); } catch {}
          return { kcal: 3400, protein: 250, carbs: 400, fat: 80 };
        })();

        return (
          <>
            {/* Header with NNU */}
            <div className="p-3 rounded-lg bg-purple-500/8 border border-purple-500/15 mb-3">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-lg font-bold text-purple-400">NNU {result.originalNNU}% → {result.finalWithEAANNU}%</span>
                <span className="text-xs text-white/20">{result.rounds.length} rounds</span>
              </div>
              <div className="text-xs text-white/30 mb-2">
                Food: {result.originalNNU}% → {result.finalFoodNNU}% | EAA: {sup ? (sup.totalPerDay / 1000).toFixed(1) : 0}g/day ({sup ? (sup.totalPerDay / sup.mealCount / 1000).toFixed(1) : 0}g/meal)
              </div>

              {/* Optimized total macros vs target */}
              <div className="grid grid-cols-4 gap-2 p-2 rounded-lg bg-white/5">
                {[
                  { label: 'Kcal', val: optMacros.kcal, target: tgts.kcal, color: '#b90a0a' },
                  { label: 'Protein', val: optMacros.protein, target: tgts.protein, unit: 'g', color: '#3b82f6' },
                  { label: 'Carbs', val: optMacros.carbs, target: tgts.carbs, unit: 'g', color: '#f59e0b' },
                  { label: 'Fat', val: optMacros.fat, target: tgts.fat, unit: 'g', color: '#10b981' },
                ].map(m => {
                  const pct = m.target > 0 ? Math.round((m.val / m.target - 1) * 100) : 0;
                  const statusColor = Math.abs(pct) <= 5 ? 'text-green-400' : pct < -5 ? 'text-yellow-400' : 'text-red-400';
                  return (
                    <div key={m.label}>
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: m.color }} />
                        <span className={`text-xs font-bold ${statusColor}`}>{m.val}</span>
                        <span className="text-[9px] text-white/20">{m.label}</span>
                      </div>
                      {pct !== 0 && <div className={`text-[9px] ml-3 ${statusColor}`}>{pct > 0 ? '+' : ''}{pct}%</div>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Full optimized meal plan preview */}
            {mainMeals.map((meal, i) => {
              const optimizedFoods = result.finalMeals[i] || [];
              const origNNU = calcNNU(meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount).map(f => ({ name: f.name, amount: f.amount })));
              const optNNU = calcNNU(optimizedFoods);
              const optMacros = sumMacros([{ ...meal, items: optimizedFoods.map(f => ({ name: f.name, amount: f.amount })) }]);

              // NNU with EAA supplement
              let optNNUWithEAA = optNNU?.nnu || 0;
              if (optNNU && sup) {
                const p = { ...optNNU.profile };
                for (const s of sup.perMeal) p[s.aa] += s.mg;
                const t = EAA_ORDER.reduce((sum, aa) => sum + p[aa], 0);
                let minR = Infinity;
                for (const aa of EAA_ORDER) { const r = (p[aa] / t * 100) / MAP[aa]; if (r < minR) minR = r; }
                optNNUWithEAA = Math.round(minR * 1000) / 10;
              }

              // Find what changed
              const origItems = meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim());

              return (
                <div key={i} className="mb-3 p-3 rounded-lg bg-white/3 border border-white/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-white">{meal.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-white/20">{origNNU?.nnu || 0}%</span>
                      <span className="text-[10px] text-purple-400 font-bold">→ {optNNUWithEAA}%</span>
                    </div>
                  </div>

                  {/* Macros */}
                  <div className="flex gap-3 mb-2 text-[10px] text-white/30">
                    <span>{optMacros.kcal} kcal</span>
                    <span>{optMacros.protein}g P</span>
                    <span>{optMacros.carbs}g C</span>
                    <span>{optMacros.fat}g F</span>
                  </div>

                  {/* Food items — show changes */}
                  {optimizedFoods.map((food, fi) => {
                    const orig = origItems.find(o => o.name.toLowerCase() === food.name.toLowerCase());
                    const isNew = !orig;
                    const isChanged = orig && orig.amount !== food.amount;
                    return (
                      <div key={fi} className={`flex justify-between text-xs py-0.5 ${isNew ? 'text-green-400/70' : isChanged ? 'text-yellow-400/70' : 'text-white/40'}`}>
                        <span>{isNew ? '+ ' : ''}{food.name}</span>
                        <span className="font-mono text-[10px]">
                          {isChanged && <span className="text-white/15 line-through mr-1">{orig.amount}</span>}
                          {food.amount || ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* EAA Supplement */}
            {sup && (
              <div className="mb-3 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <div className="text-[10px] text-cyan-400/60 uppercase tracking-wider mb-2">Daily EAA Supplement ({(sup.totalPerDay / 1000).toFixed(1)}g/day)</div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[9px] text-white/20 mb-1">Per day</div>
                    {sup.perDay.map((p, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-cyan-400/60">{EAA_NAMES[p.aa]}</span>
                        <span className="text-white/30 font-mono">{p.mg < 1000 ? `${p.mg}mg` : `${(p.mg / 1000).toFixed(1)}g`}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-[9px] text-white/20 mb-1">Per meal</div>
                    {sup.perMeal.map((p, i) => (
                      <div key={i} className="flex justify-between text-xs">
                        <span className="text-cyan-400/60">{EAA_NAMES[p.aa]}</span>
                        <span className="text-white/30 font-mono">{p.mg}mg</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={applyAll} className="flex-1 text-xs font-bold text-purple-400 bg-purple-500/15 hover:bg-purple-500/25 py-2.5 rounded-lg transition-all uppercase tracking-wider">
                Apply All Changes
              </button>
              <button onClick={() => setResult(null)} className="text-xs text-white/30 hover:text-white/50 uppercase tracking-wider px-4">
                Dismiss
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

// Per-meal EAA overview: for each meal in the plan, shows the EAA profile
// from food (mg + % of meal's EAA total) and the resulting NNU. Aggregates
// all meals' EAA contributions into a daily total row at the bottom. Toggle
// switches between "food only" and "food + prescribed EAA supplement" so
// you can see the per-meal supplement actually closes the iso gap.
function EAAOverviewPanel({ plan, allowedFoods, groupMode, manualGroups }: { plan: NutritionPlan; allowedFoods: string[]; groupMode: EAAGroupMode; manualGroups: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const [withSupplement, setWithSupplement] = useState(false);

  // Compute supplement amounts the same way the Daily EAA panel does, so the
  // numbers match what's prescribed elsewhere. With groupCount > 1 each main
  // meal can have a different mix — we map meal name → supplement mg dict.
  const isMain = (n: string) => !n.toLowerCase().includes('during workout')
    && !n.toLowerCase().includes('intra')
    && !n.toLowerCase().includes('after workout');
  const mainMealEntries = plan.current.trainingDay.meals
    .filter(meal => isMain(meal.name))
    .map(meal => ({
      name: meal.name,
      foods: meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount).map(f => ({ name: f.name, amount: f.amount as string })),
    }))
    .filter(m => m.foods.length > 0);
  const params = deriveGroupingParams(groupMode, manualGroups, mainMealEntries.map(m => m.name));
  const mainGroups: SupplementGroup[] = mainMealEntries.length > 0
    ? calcGroupedEAA(mainMealEntries.map(m => m.foods), mainMealEntries.map(m => m.name), params.groupCount, allowedFoods, 2, params.manualPartition)
    : [];
  // Map each main meal name to its group's per-meal supplement (mg by AA).
  const suppByMealName: Record<string, Record<string, number>> = {};
  for (const g of mainGroups) {
    const mg: Record<string, number> = {};
    for (const s of g.supplement.perMeal) mg[s.aa] = s.mg;
    for (const idx of g.mealIndices) suppByMealName[mainMealEntries[idx].name] = mg;
  }

  const woMeal = plan.current.trainingDay.meals.find(m => m.name.toLowerCase().includes('after workout'));
  const woFoods = woMeal ? woMeal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount).map(f => ({ name: f.name, amount: f.amount as string })) : [];
  const woSupp = woFoods.length > 0 ? calcIndividualSupplement(woFoods) : null;
  const woSuppMg: Record<string, number> = {};
  if (woSupp) for (const s of woSupp.aas) woSuppMg[s.aa] = s.mg;

  type Row = { meal: string; empty: false; totalProtein: number; totalEAA: number; profile: Record<string, number>; pcts: Record<string, number>; nnu: number; limiting: string; suppApplied: boolean } | { meal: string; empty: true };

  const rows: Row[] = plan.current.trainingDay.meals.map(meal => {
    const items = meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount);
    if (items.length === 0) return { meal: meal.name, empty: true };
    const foodInputs = items.map(f => ({ name: f.name, amount: f.amount as string }));
    const nnu = calcNNU(foodInputs);
    if (!nnu) return { meal: meal.name, empty: true };

    // Decide which supplement to layer in for "with supplement" mode.
    const lower = meal.name.toLowerCase();
    const isIntra = lower.includes('during workout') || lower.includes('intra');
    const isWO = lower.includes('after workout');
    const supp = (!withSupplement || isIntra) ? null : (isWO ? woSuppMg : (suppByMealName[meal.name] || null));

    let profile = nnu.profile;
    let pcts = nnu.pcts;
    let total = nnu.totalEAA;
    let nnuVal = nnu.nnu;
    let limiting = nnu.limiting as string;
    let suppApplied = false;
    // EAA supplement is pure amino acid powder — count its grams as protein so
    // the EAA-to-protein ratio stays meaningful and the column lines up with
    // the supplement-adjusted EAA mg values.
    let totalProtein = nnu.totalProtein;

    if (supp) {
      const p: Record<string, number> = { ...profile };
      for (const aa of EAA_ORDER) p[aa] += supp[aa] || 0;
      const t = EAA_ORDER.reduce((s, aa) => s + p[aa], 0);
      const newPcts: Record<string, number> = {};
      for (const aa of EAA_ORDER) newPcts[aa] = (p[aa] / t) * 100;
      let minR = Infinity;
      let lim = 'leu';
      for (const aa of EAA_ORDER) {
        const r = newPcts[aa] / MAP[aa];
        if (r < minR) { minR = r; lim = aa; }
      }
      profile = p;
      pcts = newPcts;
      total = t;
      nnuVal = Math.round(minR * 1000) / 10;
      limiting = lim;
      suppApplied = true;
      const suppMgSum = EAA_ORDER.reduce((s, aa) => s + (supp[aa] || 0), 0);
      totalProtein = Math.round((nnu.totalProtein + suppMgSum / 1000) * 10) / 10;
    }

    return { meal: meal.name, empty: false, totalProtein, totalEAA: total, profile, pcts, nnu: nnuVal, limiting, suppApplied };
  });

  const validRows = rows.filter((r): r is Extract<Row, { empty: false }> => !r.empty);

  // Daily totals — sum mg across meals, then re-derive %.
  const dailyMg: Record<string, number> = { leu: 0, ile: 0, val: 0, lys: 0, phe: 0, thr: 0, met: 0, trp: 0, his: 0 };
  let dailyProtein = 0;
  for (const r of validRows) {
    dailyProtein += r.totalProtein;
    for (const aa of EAA_ORDER) dailyMg[aa] += r.profile[aa];
  }
  const dailyTotalEAA = Object.values(dailyMg).reduce((s, v) => s + v, 0);
  const dailyPcts: Record<string, number> = {};
  let dailyNNU = 0;
  let dailyLimiting = 'leu' as string;
  if (dailyTotalEAA > 0) {
    for (const aa of EAA_ORDER) dailyPcts[aa] = (dailyMg[aa] / dailyTotalEAA) * 100;
    let minR = Infinity;
    for (const aa of EAA_ORDER) {
      const r = dailyPcts[aa] / MAP[aa];
      if (r < minR) { minR = r; dailyLimiting = aa; }
    }
    dailyNNU = Math.round(minR * 1000) / 10;
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => setOpen(!open)}
          className="text-xs text-white/30 hover:text-white/50 uppercase tracking-wider flex items-center gap-2"
        >
          <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>&#9654;</span>
          EAA Overview · per meal
        </button>
        {open && (
          <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-[10px] uppercase tracking-wider">
            <button
              onClick={() => setWithSupplement(false)}
              className={`px-3 py-1 transition-colors ${!withSupplement ? 'bg-white/10 text-white/80' : 'text-white/40 hover:text-white/60'}`}
            >Food only</button>
            <button
              onClick={() => setWithSupplement(true)}
              className={`px-3 py-1 transition-colors ${withSupplement ? 'bg-cyan-400/15 text-cyan-300' : 'text-white/40 hover:text-white/60'}`}
            >+ Supplement</button>
          </div>
        )}
      </div>
      {open && (
        <div className="mt-3 glass-card p-4 overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="text-white/30 text-left border-b border-white/5">
                <th className="py-2 pr-3 font-normal">Meal</th>
                <th className="py-2 px-2 font-normal text-right">Protein</th>
                <th className="py-2 px-2 font-normal text-right">EAA total</th>
                {EAA_ORDER.map(aa => (
                  <th key={aa} className="py-2 px-1 font-normal text-right" title={EAA_NAMES[aa]}>
                    {EAA_NAMES[aa].slice(0, 3)}
                  </th>
                ))}
                <th className="py-2 pl-2 font-normal text-right">NNU</th>
              </tr>
              <tr className="text-white/15 text-[9px] text-left border-b border-white/5">
                <th />
                <th />
                <th />
                {EAA_ORDER.map(aa => (
                  <th key={aa} className="py-1 px-1 font-normal text-right">
                    target {MAP[aa]}%
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                if (r.empty) {
                  return (
                    <tr key={i} className="border-b border-white/5">
                      <td className="py-2 pr-3 text-white/40">{r.meal}</td>
                      <td colSpan={11} className="py-2 text-white/20 text-[10px]">no food items</td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} className="border-b border-white/5 align-top">
                    <td className="py-2 pr-3 text-white font-medium">{r.meal}</td>
                    <td className="py-2 px-2 text-right text-white/70 font-mono">{r.totalProtein.toFixed(1)}g</td>
                    <td className="py-2 px-2 text-right text-white/70 font-mono">{(r.totalEAA / 1000).toFixed(1)}g</td>
                    {EAA_ORDER.map(aa => {
                      const mg = r.profile[aa];
                      const pct = r.pcts[aa];
                      const target = MAP[aa];
                      const isLimiting = aa === r.limiting;
                      const isLow = pct < target * 0.95;
                      const color = isLimiting ? 'text-red-400' : isLow ? 'text-yellow-400/70' : 'text-white/60';
                      return (
                        <td key={aa} className={`py-2 px-1 text-right font-mono ${color}`}>
                          <div>{Math.round(mg)}</div>
                          <div className="text-[9px] opacity-70">{pct.toFixed(1)}%</div>
                        </td>
                      );
                    })}
                    <td className="py-2 pl-2 text-right font-mono text-white/60">{r.nnu}%</td>
                  </tr>
                );
              })}
              {/* Daily totals */}
              {dailyTotalEAA > 0 && (
                <tr className="bg-white/5 align-top">
                  <td className="py-2 pr-3 text-white font-bold uppercase tracking-wider text-[10px]">Daily total</td>
                  <td className="py-2 px-2 text-right text-white font-mono font-bold">{dailyProtein.toFixed(1)}g</td>
                  <td className="py-2 px-2 text-right text-white font-mono font-bold">{(dailyTotalEAA / 1000).toFixed(1)}g</td>
                  {EAA_ORDER.map(aa => {
                    const isLimiting = aa === dailyLimiting;
                    const target = MAP[aa];
                    const pct = dailyPcts[aa];
                    const isLow = pct < target * 0.95;
                    const color = isLimiting ? 'text-red-400' : isLow ? 'text-yellow-400/70' : 'text-white/80';
                    return (
                      <td key={aa} className={`py-2 px-1 text-right font-mono font-bold ${color}`}>
                        <div>{Math.round(dailyMg[aa])}</div>
                        <div className="text-[9px] opacity-70">{pct.toFixed(1)}%</div>
                      </td>
                    );
                  })}
                  <td className="py-2 pl-2 text-right font-mono font-bold text-white">{dailyNNU}%</td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="mt-2 text-[10px] text-white/30">
            Each cell: top = mg, bottom = % of meal&apos;s EAA total. Red = limiting amino acid for that meal. Yellow = below 95% of MAP target.
            {withSupplement && <span className="ml-1 text-cyan-400/70">Prescribed EAA supplement layered in per meal — NNU should rise to ~95%.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function DailyEAAPanel({ plan, allowedFoods, groupMode, setGroupMode, manualGroups, setManualGroups }: { plan: NutritionPlan; allowedFoods: string[]; groupMode: EAAGroupMode; setGroupMode: (m: EAAGroupMode) => void; manualGroups: Record<string, number>; setManualGroups: (m: Record<string, number>) => void }) {
  // Compute daily EAA + after-workout supplement directly from current plan.
  // No localStorage caching — calcDailyEAA is fast and trusting cached state
  // caused the panel to lock onto stale 'no supplement needed' even when the
  // current plan clearly needed supplements (the cache vs recompute race bug).
  const mainMealEntries = plan.current.trainingDay.meals
    .filter(meal => !meal.name.toLowerCase().includes('during workout') && !meal.name.toLowerCase().includes('intra')
      && !meal.name.toLowerCase().includes('after workout'))
    .map(meal => ({
      name: meal.name,
      foods: meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount).map(f => ({ name: f.name, amount: f.amount as string })),
    }))
    .filter(m => m.foods.length > 0);
  const mainCount = mainMealEntries.length;
  const params = deriveGroupingParams(groupMode, manualGroups, mainMealEntries.map(m => m.name));
  const groups: SupplementGroup[] = mainCount > 0
    ? calcGroupedEAA(mainMealEntries.map(m => m.foods), mainMealEntries.map(m => m.name), params.groupCount, allowedFoods, 2, params.manualPartition)
    : [];
  // Aggregate the “daily” shape from groups for legacy storage/consumers.
  const aggregatedTotalPerDay = groups.reduce((s, g) => s + g.supplement.totalPerDay, 0);
  const aggregatedAvgNNUAfter = (() => {
    let weight = 0, sum = 0;
    for (const g of groups) {
      const w = g.mealIndices.length;
      sum += g.supplement.avgNNUAfter * w;
      weight += w;
    }
    return weight > 0 ? Math.round(sum / weight * 10) / 10 : 0;
  })();
  const aggregatedAvgNNUBefore = (() => {
    let weight = 0, sum = 0;
    for (const g of groups) {
      const w = g.mealIndices.length;
      sum += g.supplement.avgNNUBefore * w;
      weight += w;
    }
    return weight > 0 ? Math.round(sum / weight * 10) / 10 : 0;
  })();
  const daily = groups.length > 0 ? groups[0].supplement : null; // for legacy print + storage paths

  const woMealItems = (() => {
    const wo = plan.current.trainingDay.meals.find(m => m.name.toLowerCase().includes('after workout'));
    if (!wo) return [];
    return wo.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount).map(f => ({ name: f.name, amount: f.amount as string }));
  })();
  const woSupplement = woMealItems.length > 0 ? calcIndividualSupplement(woMealItems) : null;

  // Mirror to localStorage + Firestore so other surfaces stay in sync (e.g. for
  // cross-device sync of supplement amounts that user might consume).
  const persistKey = useRef('');
  useEffect(() => {
    const sig = JSON.stringify({ d: aggregatedTotalPerDay, m: groupMode, w: woSupplement?.totalMg });
    if (sig === persistKey.current) return;
    persistKey.current = sig;
    try {
      const eaaGStr = String(aggregatedTotalPerDay / 1000);
      // Legacy single-mix fields — useful when groupMode='1'; for >1 we also
      // write `eaa_groups` for richer consumers.
      localStorage.setItem('eaa_daily_result', JSON.stringify(daily));
      localStorage.setItem('eaa_g_per_day', eaaGStr);
      localStorage.setItem('eaa_per_meal', JSON.stringify(daily?.perMeal || []));
      localStorage.setItem('eaa_wo_supplement', JSON.stringify(woSupplement));
      localStorage.setItem('eaa_groups', JSON.stringify(groups));
      saveSetting('eaa_g_per_day', eaaGStr);
      saveSetting('eaa_per_meal', JSON.stringify(daily?.perMeal || []));
      saveSetting('eaa_wo_supplement', JSON.stringify(woSupplement));
      saveSetting('eaa_groups', JSON.stringify(groups));
    } catch {}
  }, [aggregatedTotalPerDay, groupMode, woSupplement, daily, groups]);

  const computing = false;

  const handlePrint = () => {
    if (groups.length === 0) return;
    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    const fmt = (mg: number) => `${(mg / 1000).toFixed(2)} g`;
    const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

    const groupSections = groups.map((g, gi) => {
      const perMealMap = new Map(g.supplement.perMeal.map(p => [p.aa, p.mg]));
      const totalDaily = g.supplement.totalPerDay;
      const totalPerMeal = totalDaily / g.supplement.mealCount;
      const perServingG = (totalPerMeal / 1000).toFixed(2);
      const rows = g.supplement.perDay.map(p => {
        const perMealMg = perMealMap.get(p.aa) ?? (p.mg / g.supplement.mealCount);
        return `<tr><td>${EAA_NAMES[p.aa]}</td><td>${fmt(perMealMg)}</td><td>${fmt(p.mg)}</td><td>${fmt(p.mg * 3)}</td><td>${fmt(p.mg * 7)}</td></tr>`;
      }).join('');
      const totalRow = `<tr class="total"><td>TOTAL</td><td>${fmt(totalPerMeal)}</td><td>${fmt(totalDaily)}</td><td>${fmt(totalDaily * 3)}</td><td>${fmt(totalDaily * 7)}</td></tr>`;
      const label = groups.length === 1 ? 'Main Mix' : `Mix ${String.fromCharCode(65 + gi)}`;
      const mealNames = g.mealNames.map(esc).join(' · ');
      return `
        <h2>${label} <span class="hint">${esc(mealNames)} &middot; ~${perServingG} g per meal</span></h2>
        <table>
          <thead><tr><th>Amino Acid</th><th>Per Meal</th><th>1 Day</th><th>3 Days</th><th>1 Week</th></tr></thead>
          <tbody>${rows}${totalRow}</tbody>
        </table>`;
    }).join('');

    let woSection = '';
    if (woSupplement) {
      const woRows = woSupplement.aas.map(s =>
        `<tr><td>${EAA_NAMES[s.aa as keyof typeof EAA_NAMES] || s.aa}</td><td>${fmt(s.mg)}</td><td>${fmt(s.mg * 3)}</td><td>${fmt(s.mg * 7)}</td></tr>`
      ).join('');
      const woTotal = `<tr class="total"><td>TOTAL</td><td>${fmt(woSupplement.totalMg)}</td><td>${fmt(woSupplement.totalMg * 3)}</td><td>${fmt(woSupplement.totalMg * 7)}</td></tr>`;
      woSection = `
        <h2>After Workout <span class="hint">single serving · ${(woSupplement.totalMg / 1000).toFixed(2)} g per meal</span></h2>
        <table>
          <thead><tr><th>Amino Acid</th><th>1 Meal</th><th>3 Meals</th><th>7 Meals</th></tr></thead>
          <tbody>${woRows}${woTotal}</tbody>
        </table>`;
    }

    const mixNoun = groups.length === 1 ? 'a single jar' : `${groups.length} labelled jars`;
    const bodyHtml = `
  <h1>EAA Supplement Mix</h1>
  <div class="meta">Generated ${date} &middot; <span class="nnu">NNU ${aggregatedAvgNNUBefore}% &rarr; ${aggregatedAvgNNUAfter}%</span> &middot; ${mainCount} meals/day &middot; ${groups.length} ${groups.length === 1 ? 'mix' : 'mixes'}</div>
  ${groupSections}
  ${woSection}
  <div class="note">
    <strong>How to mix:</strong> weigh each amino acid (precision scale &ge; 0.01 g) and combine into ${mixNoun}. Take the listed per-meal dose with each labelled meal.
    ${woSupplement ? `Mix the After-Workout blend separately; take ${(woSupplement.totalMg / 1000).toFixed(2)} g after each workout.` : ''}
  </div>
  <div class="footer">bodybuilding &middot; ${date}</div>`;

    const css = `
  h1 { font-size: 22pt; margin: 0 0 2pt 0; letter-spacing: -0.4pt; font-weight: 700; }
  h2 { font-size: 11pt; margin: 18pt 0 6pt 0; padding-bottom: 4pt; border-bottom: 1.5px solid #111; letter-spacing: 0.5pt; text-transform: uppercase; font-weight: 700; }
  .hint { font-weight: 400; color: #666; font-size: 9pt; text-transform: none; letter-spacing: 0; margin-left: 6pt; }
  .meta { color: #555; font-size: 9.5pt; margin-bottom: 10pt; padding-bottom: 8pt; border-bottom: 1.5px solid #111; }
  .nnu { color: #0a7c8c; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  th { text-align: left; padding: 5pt 10pt; background: #f0f0f0; border-bottom: 1px solid #aaa; font-weight: 600; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5pt; }
  th:not(:first-child), td:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
  td { padding: 5pt 10pt; border-bottom: 1px solid #eee; }
  tr.total td { border-top: 1.5px solid #222; border-bottom: none; padding-top: 7pt; font-weight: 700; }
  .note { margin-top: 14pt; font-size: 9pt; color: #555; line-height: 1.5; }
  .footer { margin-top: 18pt; font-size: 8pt; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 6pt; }`;

    openPrintWindow(buildA4PrintDoc({ title: 'EAA Supplement Mix', bodyHtml, extraCss: css }));
  };

  // Grouping options. Hide "2 mixes" variants if there are < 3 main meals
  // (degenerates to per-meal).
  const modeOptions: { value: EAAGroupMode; label: string; sub: string }[] = [
    { value: '1', label: '1 mix', sub: 'simplest' },
  ];
  if (mainCount >= 3) modeOptions.push({ value: '2-auto', label: '2 auto', sub: 'optimal pairing' });
  if (mainCount >= 3) modeOptions.push({ value: '2-manual', label: '2 manual', sub: 'you pick A / B' });
  if (mainCount >= 2) modeOptions.push({ value: 'per-meal', label: `${mainCount} per meal`, sub: 'highest NNU' });

  // When the user first switches to '2-manual', seed the assignment from
  // either the auto-best partition (if available) or split-by-index. Without
  // this, all meals start on A and only one mix shows.
  useEffect(() => {
    if (groupMode !== '2-manual' || mainCount < 2) return;
    const allAssigned = mainMealEntries.every(m => manualGroups[m.name] !== undefined);
    if (allAssigned) return;
    // Seed: use the auto pairing as the starting point if it exists.
    const autoGroups = calcGroupedEAA(
      mainMealEntries.map(m => m.foods),
      mainMealEntries.map(m => m.name),
      2,
      allowedFoods,
      2,
    );
    const seed: Record<string, number> = { ...manualGroups };
    if (autoGroups.length === 2) {
      autoGroups.forEach((g, gi) => g.mealIndices.forEach(idx => {
        if (seed[mainMealEntries[idx].name] === undefined) seed[mainMealEntries[idx].name] = gi;
      }));
    } else {
      // Fallback: split by index.
      const half = Math.floor(mainCount / 2);
      mainMealEntries.forEach((m, i) => {
        if (seed[m.name] === undefined) seed[m.name] = i < half ? 0 : 1;
      });
    }
    setManualGroups(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupMode, mainCount]);

  const groupLabel = (gi: number) => String.fromCharCode(65 + gi); // 0→A, 1→B

  return (
    <div className="mb-6 glass-card p-5">
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-white">Daily EAA Supplement</h3>
        <div className="flex items-center gap-2">
          {/* Grouping selector */}
          {mainCount >= 2 && (
            <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-[10px] uppercase tracking-wider">
              {modeOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setGroupMode(opt.value)}
                  title={opt.sub}
                  className={`px-2.5 py-1 transition-colors ${groupMode === opt.value ? 'bg-cyan-400/15 text-cyan-300' : 'text-white/40 hover:text-white/60'}`}
                >{opt.label}</button>
              ))}
            </div>
          )}
          {groups.length > 0 && (
            <button onClick={handlePrint} className={PRINT_BTN_CLASS} title="Print as PDF — daily, 3-day, weekly amounts">
              Print
            </button>
          )}
        </div>
      </div>

      {/* Manual assignment — only when 2-manual is selected */}
      {groupMode === '2-manual' && mainCount >= 2 && (
        <div className="mb-4 p-3 rounded-lg border border-white/10 bg-white/[0.02]">
          <div className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Assign each meal</div>
          <div className="flex flex-wrap gap-2">
            {mainMealEntries.map(m => {
              const current = manualGroups[m.name] ?? 0;
              return (
                <div key={m.name} className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-white/60">{m.name}</span>
                  <div className="inline-flex rounded border border-white/10 overflow-hidden text-[10px]">
                    {[0, 1].map(gi => (
                      <button
                        key={gi}
                        onClick={() => setManualGroups({ ...manualGroups, [m.name]: gi })}
                        className={`px-2 py-0.5 transition-colors ${current === gi
                          ? gi === 0 ? 'bg-cyan-400/20 text-cyan-300' : 'bg-amber-400/20 text-amber-300'
                          : 'text-white/40 hover:text-white/60'}`}
                      >{groupLabel(gi)}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {groups.length > 0 ? (
        <>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <span className="text-lg font-bold text-cyan-400">NNU {aggregatedAvgNNUBefore}% → {aggregatedAvgNNUAfter}%</span>
            <span className="text-xs text-white/20">{mainCount} meals · {(aggregatedTotalPerDay / 1000).toFixed(1)}g/day across {groups.length} {groups.length === 1 ? 'mix' : 'mixes'}</span>
          </div>

          {/* One card per group */}
          <div className={groups.length > 1 ? 'space-y-3' : ''}>
            {groups.map((g, gi) => {
              const perMealMg = g.supplement.perMeal.reduce((s, p) => s + p.mg, 0);
              const perMealG = perMealMg / 1000;
              const dailyMg = perMealMg * g.mealIndices.length;
              const mixLabel = groups.length === 1 ? 'Main Mix' : `Mix ${String.fromCharCode(65 + gi)}`;
              return (
                <div key={gi} className={groups.length > 1 ? 'rounded-lg border border-white/5 p-3' : ''}>
                  <div className="flex items-baseline gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-semibold text-cyan-300">{mixLabel}</span>
                    <span className="text-[10px] text-white/40">{g.mealNames.join(' · ')}</span>
                    <span className="text-[10px] text-white/30 ml-auto">{perMealG.toFixed(2)}g/meal × {g.mealIndices.length} = {(dailyMg/1000).toFixed(2)}g/day</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Per meal</div>
                      {g.supplement.perMeal.map((p, i) => (
                        <div key={i} className="flex justify-between text-xs mb-0.5">
                          <span className="text-cyan-400/70">{EAA_NAMES[p.aa]}</span>
                          <span className="text-white/40 font-mono">{p.mg}mg</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[10px] text-white/25 uppercase tracking-wider mb-1.5">Total per day</div>
                      {g.supplement.perDay.map((p, i) => (
                        <div key={i} className="flex justify-between text-xs mb-0.5">
                          <span className="text-cyan-400/70">{EAA_NAMES[p.aa]}</span>
                          <span className="text-white/40 font-mono">{p.mg < 1000 ? `${p.mg}mg` : `${(p.mg/1000).toFixed(1)}g`}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {groups.length > 1 && (
                    <div className="mt-2 text-[10px] text-white/30">
                      NNU {g.supplement.avgNNUBefore}% → {g.supplement.avgNNUAfter}% across {g.mealIndices.length} meal{g.mealIndices.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-white/5 text-[10px] text-white/20">
            {groups.length === 1
              ? `Mix into a single jar. Take ${(aggregatedTotalPerDay / mainCount / 1000).toFixed(2)} g with each main meal.`
              : `Mix each blend into its own labelled jar. Take the labelled dose with each listed meal.`}
          </div>

          {/* After Workout individual supplement */}
          {woSupplement && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-sm font-semibold text-amber-400">After Workout</span>
                <span className="text-xs text-white/20">{(woSupplement.totalMg / 1000).toFixed(2)}g · NNU {woSupplement.foodNNU}% → {woSupplement.finalNNU}%</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                {woSupplement.aas.map((s, i) => (
                  <div key={i} className="text-xs flex justify-between">
                    <span className="text-amber-400/60">{EAA_NAMES[s.aa]}</span>
                    <span className="text-white/40 font-mono">{s.mg}mg</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total daily */}
          <div className="mt-3 pt-3 border-t border-white/5 text-[10px] text-white/30">
            Total daily: {((aggregatedTotalPerDay + (woSupplement?.totalMg || 0)) / 1000).toFixed(2)}g
            <span className="text-white/15"> ({(aggregatedTotalPerDay / 1000).toFixed(2)}g main + {((woSupplement?.totalMg || 0) / 1000).toFixed(2)}g after WO)</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-white/30">No supplement needed — all meals above 95% NNU.</div>
      )}
    </div>
  );
}

function MacroTarget({ label, value, onChange, unit, color }: { label: string; value: number; onChange: (v: number) => void; unit: string; color: string }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));
  return editing ? (
    <div className="p-1.5 min-w-0">
      <div className="flex items-center gap-1 mb-0.5">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[10px] text-white/40 truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <input type="number" className="glass-input w-full text-base font-bold text-white py-0.5 px-1 tabular-nums min-w-0"
          value={input} onChange={e => setInput(e.target.value)} autoFocus
          onBlur={() => { onChange(parseInt(input) || value); setEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { onChange(parseInt(input) || value); setEditing(false); } }} />
        {unit && <span className="text-[9px] text-white/30">{unit}</span>}
      </div>
    </div>
  ) : (
    <button onClick={() => { setInput(String(value)); setEditing(true); }} className="text-left p-1.5 min-w-0 hover:bg-white/5 rounded transition-all">
      <div className="flex items-center gap-1 mb-0.5">
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[10px] text-white/40 truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className="text-base font-bold text-white tabular-nums">{value}</span>
        {unit && <span className="text-[9px] text-white/30">{unit}</span>}
      </div>
    </button>
  );
}

function DayPlanView({ dayPlan, title, color, editing, onStartEdit, onSave, onCancel, editPlan, setEditPlan, allowedFoods, onSaveOptimizedMeal, recommendedTargets, eaaGroupMode, eaaManualGroups }: {
  dayPlan: DayPlan;
  title: string;
  color: string;
  allowedFoods?: string[];
  onSaveOptimizedMeal?: (mealIdx: number, meal: NutritionMeal) => void;
  editing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editPlan: DayPlan | null;
  setEditPlan: (p: DayPlan) => void;
  recommendedTargets?: { kcal: number; protein: number; carbs: number; fat: number } | null;
  eaaGroupMode: EAAGroupMode;
  eaaManualGroups: Record<string, number>;
}) {
  // Track which Recommended-macro info popover is open
  const [expandedRec, setExpandedRec] = useState<string | null>(null);

  // Target macros — editable, stored in localStorage + synced via settings
  const [targets, setTargets] = useState(() => {
    if (typeof window !== 'undefined') {
      try { const stored = localStorage.getItem('macro_targets'); if (stored) return JSON.parse(stored); } catch {}
    }
    return { kcal: dayPlan.macros.kcal, protein: dayPlan.macros.protein, carbs: dayPlan.macros.carbs, fat: dayPlan.macros.fat };
  });
  // Load targets from Firestore DIRECTLY on mount — but don't overwrite user edits in flight
  const editedRef = useRef(false);
  useEffect(() => {
    getSettingRemote('macro_targets').then(v => {
      if (v && !editedRef.current) {
        try {
          const parsed = JSON.parse(v);
          setTargets(parsed);
          localStorage.setItem('macro_targets', v);
        } catch {}
      }
    });
  }, []);
  const updateTarget = (key: string, value: number) => {
    editedRef.current = true;
    const next = { ...targets, [key]: value };
    setTargets(next);
    localStorage.setItem('macro_targets', JSON.stringify(next));
    saveSetting('macro_targets', JSON.stringify(next));
  };

  // Actual macros — computed in real-time from all meals + live EAA supplements
  // (no localStorage read — derived directly from current plan in the NNU calc above)
  const foodMacros = sumMacros(dayPlan.meals);
  const isExcludedMain = (n: string) => { const l = n.toLowerCase(); return l.includes('during workout') || l.includes('intra') || l.includes('after workout'); };
  const liveMainMealFoods = dayPlan.meals.filter(m => !isExcludedMain(m.name)).map(m => {
    const items = m.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount);
    return items.map(f => ({ name: f.name, amount: f.amount as string }));
  }).filter(m => m.length > 0);
  const liveMainMealNames = dayPlan.meals.filter(m => !isExcludedMain(m.name)).map(m => m.name)
    .filter((_, i) => liveMainMealFoods[i]?.length > 0);
  // Grouped supplement: with groupCount=1 this is a single mix; with =2 two
  // pairs; with =meals.length one per meal.
  const liveGroupingParams = deriveGroupingParams(eaaGroupMode, eaaManualGroups, liveMainMealNames);
  const liveGroups = liveMainMealFoods.length > 0
    ? calcGroupedEAA(liveMainMealFoods, liveMainMealNames, liveGroupingParams.groupCount, undefined, 2, liveGroupingParams.manualPartition)
    : [];
  // Total main mix grams across all groups (sum of per-meal × meal count per group).
  const eaaG = liveGroups.reduce((sum, g) => sum + (g.supplement.totalPerDay / 1000), 0);
  // Legacy single-mix view for surfaces that haven't migrated yet (storage cache):
  const liveDaily = liveGroups.length === 1 ? liveGroups[0].supplement : null;
  // Map each main meal name → its group's per-meal supplement. MealCard reads
  // this so its NNU/supplement display reflects the actual mix that meal will
  // get under the current grouping mode.
  const suppByMealName: Record<string, { aa: string; mg: number }[]> = {};
  for (const g of liveGroups) {
    for (const idx of g.mealIndices) {
      suppByMealName[liveMainMealNames[idx]] = g.supplement.perMeal;
    }
  }
  const liveWO = (() => {
    const wo = dayPlan.meals.find(m => m.name.toLowerCase().includes('after workout'));
    if (!wo) return null;
    const items = wo.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount).map(f => ({ name: f.name, amount: f.amount as string }));
    return items.length > 0 ? calcIndividualSupplement(items) : null;
  })();
  // Include both the main EAA mix (across all groups) and the After-Workout
  // supplement so the dashboard total matches the EAA Overview Daily Total
  // (both supplements counted).
  const woG = liveWO ? liveWO.totalMg / 1000 : 0;
  const actualMacros = {
    kcal: foodMacros.kcal + Math.round((eaaG + woG) * 4),
    protein: foodMacros.protein + Math.round(eaaG + woG),
    carbs: foodMacros.carbs,
    fat: foodMacros.fat,
  };

  // Parsed supplement state: avoids re-parsing joined strings on every keystroke
  const [supState, setSupState] = useState<Record<string, { name: string; amount: string }>>({});

  // Build a stable key for a supplement slot
  const supKey = (mealIdx: number, supIdx: number) => `${mealIdx}-${supIdx}`;

  // Get the parsed name/amount for a supplement, initializing from the string if needed
  const getSupParts = (mealIdx: number, supIdx: number, raw: string) => {
    const key = supKey(mealIdx, supIdx);
    if (supState[key]) return supState[key];
    return parseSupplement(raw);
  };

  const updateMealItemName = (mealIdx: number, itemIdx: number, name: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, items: m.items.map((it, ii) => ii === itemIdx ? calcItemMacros({ ...it, name }) : it) } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const updateMealItemAmount = (mealIdx: number, itemIdx: number, amount: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, items: m.items.map((it, ii) => ii === itemIdx ? calcItemMacros({ ...it, amount: amount || undefined }) : it) } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const addMealItem = (mealIdx: number) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, items: [...m.items, { name: '' }] } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const removeMealItem = (mealIdx: number, itemIdx: number) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, items: m.items.filter((_, ii) => ii !== itemIdx) } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const updateSupplementField = (mealIdx: number, supIdx: number, field: 'name' | 'amount', value: string) => {
    if (!editPlan) return;
    const key = supKey(mealIdx, supIdx);
    const raw = (editPlan.meals[mealIdx]?.supplements || [])[supIdx] || '';
    const current = getSupParts(mealIdx, supIdx, raw);
    const updated = { ...current, [field]: value };
    setSupState(prev => ({ ...prev, [key]: updated }));
    const meals = editPlan.meals.map((m, mi) => {
      if (mi !== mealIdx) return m;
      const sups = (m.supplements || []).map((s, si) =>
        si === supIdx ? joinSupplement(updated.name, updated.amount) : s
      );
      return { ...m, supplements: sups };
    });
    setEditPlan({ ...editPlan, meals });
  };

  const addSupplement = (mealIdx: number) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, supplements: [...(m.supplements || []), ''] } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const removeSupplement = (mealIdx: number, supIdx: number) => {
    if (!editPlan) return;
    // Clear supState for this meal because supplement indices shift after removal
    setSupState(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (k.startsWith(`${mealIdx}-`)) delete next[k]; });
      return next;
    });
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, supplements: (m.supplements || []).filter((_, si) => si !== supIdx) } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const updateMealName = (mealIdx: number, name: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, name } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const updateMealSubtitle = (mealIdx: number, subtitle: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, subtitle: subtitle || undefined } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const addMeal = () => {
    if (!editPlan) return;
    setEditPlan({ ...editPlan, meals: [...editPlan.meals, { name: `Meal ${editPlan.meals.length + 1}`, items: [{ name: '' }] }] });
  };

  const removeMeal = (mealIdx: number) => {
    if (!editPlan) return;
    // Clear supState because meal indices shift after removal
    setSupState({});
    setEditPlan({ ...editPlan, meals: editPlan.meals.filter((_, i) => i !== mealIdx) });
  };

  const plan = editing && editPlan ? editPlan : dayPlan;
  const computedMacros = sumMacros(plan.meals);

  const handlePrintPlan = () => {
    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
    // Macros from food items only (no supplements)
    const itemOnlyMeals = plan.meals.map(m => ({ ...m, supplements: [] }));
    const totalMacros = sumMacros(itemOnlyMeals);

    const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

    const mealSections = plan.meals.map(meal => {
      const items = meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim());
      if (items.length === 0) return '';
      const mealMacros = sumMacros([{ ...meal, items, supplements: [] }]);
      const itemRows = items.map(it => {
        const amt = it.amount ? escapeHtml(it.amount) : '&mdash;';
        const m = calcItemMacros(it);
        const macroBits = (m.kcal || m.protein || m.carbs || m.fat)
          ? `<span class="m">${Math.round(m.kcal || 0)} kcal &middot; ${Math.round(m.protein || 0)}P &middot; ${Math.round(m.carbs || 0)}C &middot; ${Math.round(m.fat || 0)}F</span>`
          : '';
        return `<tr><td>${escapeHtml(it.name)}</td><td class="amt">${amt}</td><td class="macro">${macroBits}</td></tr>`;
      }).join('');
      const subtitle = meal.subtitle ? `<span class="hint">${escapeHtml(meal.subtitle)}</span>` : '';
      return `
        <section class="meal">
          <h2>${escapeHtml(meal.name)} ${subtitle}<span class="meal-kcal">${mealMacros.kcal} kcal &middot; ${mealMacros.protein}P / ${mealMacros.carbs}C / ${mealMacros.fat}F</span></h2>
          <table><tbody>${itemRows}</tbody></table>
        </section>`;
    }).filter(Boolean).join('');

    // Headline uses the same total the app shows on the Actual card (2701-style),
    // which includes supplement kcal and the prescribed EAA mix — so it accounts
    // for the otherwise-missing intra-workout meal (supplements only) and the
    // per-meal supplement macros that the printed meal list doesn't itemize.
    const extrasKcal = Math.max(0, actualMacros.kcal - totalMacros.kcal);
    const extrasLine = extrasKcal > 0
      ? `<div class="meta-sub bordered">${totalMacros.kcal} kcal from listed food + ${extrasKcal} kcal from supplements &amp; intra-workout</div>`
      : '';
    const metaClass = extrasKcal > 0 ? 'meta' : 'meta bordered';

    const bodyHtml = `
  <h1>${escapeHtml(title)} Meal Plan</h1>
  <div class="${metaClass}">Generated ${date} &middot; <strong>${actualMacros.kcal} kcal</strong> &middot; ${actualMacros.protein} g protein &middot; ${actualMacros.carbs} g carbs &middot; ${actualMacros.fat} g fat</div>
  ${extrasLine}
  ${mealSections}
  <div class="footer">bodybuilding &middot; ${date}</div>`;

    const css = `
  h1 { font-size: 22pt; margin: 0 0 2pt 0; letter-spacing: -0.4pt; font-weight: 700; }
  .meta { color: #555; font-size: 9.5pt; }
  .meta-sub { color: #888; font-size: 8.5pt; margin-top: 2pt; font-style: italic; }
  .bordered { margin-bottom: 10pt; padding-bottom: 8pt; border-bottom: 1.5px solid #111; }
  section.meal { margin-bottom: 10pt; page-break-inside: avoid; }
  h2 { font-size: 10.5pt; margin: 0 0 3pt 0; padding-bottom: 3pt; border-bottom: 1px solid #ccc; letter-spacing: 0.4pt; text-transform: uppercase; font-weight: 700; display: flex; align-items: baseline; gap: 8pt; }
  .hint { font-weight: 400; color: #666; font-size: 8.5pt; text-transform: none; letter-spacing: 0; }
  .meal-kcal { margin-left: auto; font-weight: 600; color: #333; font-size: 9pt; letter-spacing: 0.2pt; text-transform: none; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  td { padding: 2pt 6pt; border-bottom: 1px solid #f1f1f1; vertical-align: baseline; }
  td:first-child { padding-left: 0; }
  td:last-child { padding-right: 0; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: #222; font-weight: 600; width: 60pt; }
  td.macro { text-align: right; color: #888; font-size: 8pt; font-variant-numeric: tabular-nums; white-space: nowrap; width: 130pt; }
  .footer { margin-top: 12pt; padding-top: 6pt; border-top: 1px solid #eee; font-size: 8pt; color: #999; text-align: center; }`;

    openPrintWindow(buildA4PrintDoc({ title: `${title} Meal Plan`, bodyHtml, extraCss: css }));
  };

  return (
    <div className="glass-card overflow-hidden p-5">
          {/* Whole-day weighted NNU — protein-weighted across ALL real meals.
              Main meals use whichever mix their supplement group prescribes
              (single shared, paired, or per-meal); After Workout uses its own
              individual supplement. Computed live so this header agrees with
              the per-meal pills and the Daily EAA panel. */}
          {(() => {
            const isIntraOrEmpty = (n: string) => {
              const l = n.toLowerCase();
              return l.includes('during workout') || l.includes('intra') || l.includes('empty stomach');
            };
            const isAfterWO = (n: string) => n.toLowerCase().includes('after workout');

            // suppByMealName + eaaG already account for groupCount — they were
            // computed earlier in DayPlanView from calcGroupedEAA.
            const supplementGramsPerMeal = liveMainMealNames.length > 0
              ? Math.round(eaaG / liveMainMealNames.length * 100) / 10
              : 0;

            // Compute per-meal NNU (food-only and with-EAA) across ALL real meals
            // including After Workout (which uses individual EAA via liveWO).
            let totalProt = 0, weightedFood = 0, weightedEAA = 0;
            for (const meal of dayPlan.meals) {
              if (isIntraOrEmpty(meal.name)) continue;
              const items = meal.items
                .map(it => { try { return parseFoodItem(it); } catch { return { name: '' }; } })
                .filter(it => it.name.trim() && it.amount)
                .map(f => ({ name: f.name, amount: f.amount as string }));
              if (items.length === 0) continue;
              const r = calcNNU(items);
              if (!r || r.totalProtein <= 0) continue;
              const eaaToAdd = isAfterWO(meal.name)
                ? (liveWO?.aas || [])
                : (suppByMealName[meal.name] || []);
              let withEAA = r.nnu;
              if (eaaToAdd.length > 0) {
                const p = { ...r.profile };
                for (const s of eaaToAdd) { const k = s.aa as keyof typeof p; if (p[k] !== undefined) p[k] += s.mg; }
                const t = EAA_ORDER.reduce((sum, aa) => sum + p[aa], 0);
                let minR = Infinity;
                for (const aa of EAA_ORDER) { const ratio = (p[aa] / t * 100) / MAP[aa]; if (ratio < minR) minR = ratio; }
                withEAA = Math.round(minR * 1000) / 10;
              }
              totalProt += r.totalProtein;
              weightedFood += r.nnu * r.totalProtein;
              weightedEAA += withEAA * r.totalProtein;
            }
            const avgNNUFood = totalProt > 0 ? Math.round(weightedFood / totalProt * 10) / 10 : null;
            const avgNNUWithEAA = totalProt > 0 ? Math.round(weightedEAA / totalProt * 10) / 10 : avgNNUFood;

            return (
              <>
                {/* NNU — Net Nitrogen Utilization, the most important quality signal */}
                {avgNNUFood !== null && (
                  <div className="mb-3 p-3 rounded-xl bg-gradient-to-br from-cyan-500/[0.08] to-blue-500/[0.04] border border-cyan-500/20">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-semibold text-cyan-300 uppercase tracking-[0.15em]">NNU</div>
                      <div className="text-[9px] text-white/30">Net Nitrogen Utilization</div>
                    </div>
                    <div className="flex items-baseline gap-3 mt-1">
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-black text-white data-value">{avgNNUFood}</span>
                          <span className="text-sm text-white/40">%</span>
                        </div>
                        <span className="text-[9px] text-white/30 uppercase">food only</span>
                      </div>
                      <span className="text-2xl text-white/30">→</span>
                      <div className="flex flex-col">
                        <div className="flex items-baseline gap-1">
                          <span className={`text-3xl font-black data-value ${avgNNUWithEAA != null && avgNNUWithEAA > avgNNUFood ? 'text-cyan-300' : 'text-white/60'}`}>
                            {avgNNUWithEAA != null ? avgNNUWithEAA : avgNNUFood}
                          </span>
                          <span className="text-sm text-white/40">%</span>
                        </div>
                        <span className="text-[9px] text-white/30 uppercase">
                          {supplementGramsPerMeal > 0 ? `with EAA (${supplementGramsPerMeal}g/meal avg)` : 'no EAA needed'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Recommended macros — science-based, computed from weight + TDEE + phase */}
                {recommendedTargets && (
                  <div className="mb-1">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[9px] text-cyan-400/40 uppercase tracking-wider">
                        Recommended <span className="text-white/20 normal-case tracking-normal">— science-based, tap for sources</span>
                      </div>
                    </div>
                    {(() => {
                      // NNU-adjusted protein: at standard ~70% NNU the rec is 2.25 g/kg;
                      // Mark's whole-day NNU with EAA is ~92% → equivalent MPS at less protein.
                      // Formula: adjusted = standard × (70 / actual_NNU), rounded to nearest 5g.
                      const refNNU = 70;
                      const nnuAdjProtein = (avgNNUWithEAA != null && avgNNUWithEAA > refNNU)
                        ? Math.round(recommendedTargets.protein * refNNU / avgNNUWithEAA / 5) * 5
                        : null;
                      return (
                        <div className="grid grid-cols-4 gap-1.5 p-2 rounded-xl bg-cyan-500/[0.04] border border-cyan-500/10">
                          {[
                            { label: 'Kcal', val: recommendedTargets.kcal, current: targets.kcal, unit: '', color: '#b90a0a' },
                            { label: 'Protein', val: recommendedTargets.protein, current: targets.protein, unit: 'g', color: '#3b82f6', adj: nnuAdjProtein },
                            { label: 'Carbs', val: recommendedTargets.carbs, current: targets.carbs, unit: 'g', color: '#f59e0b' },
                            { label: 'Fat', val: recommendedTargets.fat, current: targets.fat, unit: 'g', color: '#10b981' },
                          ].map(m => {
                            const delta = m.current - m.val;
                            const matched = Math.abs(delta) <= (m.label === 'Kcal' ? 50 : 5);
                            const isOpen = expandedRec === m.label;
                            return (
                              <button
                                key={m.label}
                                type="button"
                                onClick={() => setExpandedRec(isOpen ? null : m.label)}
                                className={`text-left rounded p-1.5 transition-colors min-w-0 ${isOpen ? 'bg-cyan-500/10' : 'hover:bg-white/[0.03]'}`}
                              >
                                <div className="flex items-center gap-1 mb-0.5">
                                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                                  <span className="text-[10px] text-white/40 truncate">{m.label}</span>
                                  <span className="text-[9px] text-cyan-400/40 ml-auto shrink-0">{isOpen ? '×' : 'ⓘ'}</span>
                                </div>
                                <div className="flex items-baseline gap-0.5">
                                  <span className="text-base font-bold text-white tabular-nums">{m.val}</span>
                                  {m.unit && <span className="text-[9px] text-white/30">{m.unit}</span>}
                                </div>
                                {'adj' in m && m.adj != null && (
                                  <div className="text-[9px] text-cyan-400/60 truncate">
                                    NNU {m.adj}g
                                  </div>
                                )}
                                {!matched && (
                                  <div className={`text-[9px] truncate ${delta > 0 ? 'text-green-400/60' : 'text-yellow-400/60'}`}>
                                    {delta > 0 ? '−' : '+'}{Math.abs(delta)}
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {expandedRec && (
                      <div className="mt-2 p-3 rounded-lg bg-cyan-500/[0.06] border border-cyan-500/15 text-[11px] text-white/70 leading-relaxed">
                        {expandedRec === 'Kcal' && (
                          <div>
                            <div className="font-semibold text-cyan-300 mb-1">Kcal — TDEE × (1 + surplus%)</div>
                            <div className="mb-2">
                              <strong className="text-white">{recommendedTargets.kcal} kcal/day</strong> = your derived TDEE × 1.15 (rounded to 50). Bulks of +10–20% surplus give the cleanest muscle:fat ratio. Above +20% the extra calories almost all become fat.
                            </div>
                            <div className="text-white/40 text-[10px]">
                              <strong className="text-white/60">Sources:</strong> Helms et al. <em>Recommendations for natural bodybuilding contest preparation</em> (J Int Soc Sports Nutr, 2014) · Israetel, <em>Renaissance Periodization Diet</em> · MASS Research Review meta-analyses.
                            </div>
                          </div>
                        )}
                        {expandedRec === 'Protein' && (
                          <div>
                            <div className="font-semibold text-cyan-300 mb-1">Protein — 2.25 g/kg bodyweight</div>
                            <div className="mb-2">
                              <strong className="text-white">{recommendedTargets.protein} g/day</strong> = bodyweight × 2.25 g/kg. Range 1.6–2.4 g/kg covers nearly all muscle-building outcomes; upper-end favoured for trained lifters and TRT users (slightly elevated MPS resistance). Distributed evenly across 4–5 meals at ~0.4 g/kg each maximizes the MPS pulse.
                            </div>
                            {avgNNUWithEAA != null && avgNNUWithEAA > 70 && (
                              <div className="rounded p-2 bg-cyan-500/10 border border-cyan-500/25 mb-2">
                                <div className="text-[10px] font-semibold text-cyan-300 mb-0.5">NNU adjustment — why you could eat less</div>
                                <div className="text-[10px] text-white/70 leading-relaxed">
                                  Standard protein recommendations assume ~70% Net Nitrogen Utilization (the typical Western mixed diet). With your optimized plan (EAA supplement filling the gaps per meal), your whole-day NNU is <strong className="text-cyan-300">{avgNNUWithEAA}%</strong>. You&apos;re getting more usable protein per gram eaten.
                                  <br/><br/>
                                  Scaled equivalent: <strong className="text-white">~{Math.round(recommendedTargets.protein * 70 / avgNNUWithEAA / 5) * 5} g/day</strong> at your NNU gives the same MPS as {recommendedTargets.protein} g at 70% NNU. Shown below the main target as &quot;NNU-adj&quot;.
                                  <br/><br/>
                                  <span className="text-white/50">Caveat: the main recommendation stays at 2.25 g/kg because protein has uses beyond MPS (immune, connective tissue, satiety, thermic effect) that don&apos;t benefit from high NNU. Treat the adjusted number as the floor — never go below it.</span>
                                </div>
                              </div>
                            )}
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div className="rounded p-2 bg-yellow-500/10 border border-yellow-500/20">
                                <div className="text-[10px] font-semibold text-yellow-400 mb-0.5">Under-eating ⤓</div>
                                <div className="text-[10px] text-white/60">Reduced MPS, slower recovery, real muscle loss in a deficit, blunted training adaptation, lower satiety leading to overeating other macros.</div>
                              </div>
                              <div className="rounded p-2 bg-orange-500/10 border border-orange-500/20">
                                <div className="text-[10px] font-semibold text-orange-400 mb-0.5">Over-eating ⤒</div>
                                <div className="text-[10px] text-white/60">Largely harmless for healthy kidneys, but crowds out carbs (performance) and fat (hormones). Wasted protein gets oxidized — it&apos;s just expensive calories.</div>
                              </div>
                            </div>
                            <div className="text-white/40 text-[10px]">
                              <strong className="text-white/60">Sources:</strong> Jäger et al. <em>ISSN Position Stand: Protein and exercise</em> (J Int Soc Sports Nutr, 2017) · Schoenfeld & Aragon, <em>How much protein can the body use in a single meal</em> (J Int Soc Sports Nutr, 2018) · Morton et al. meta-analysis (Br J Sports Med, 2018).
                            </div>
                          </div>
                        )}
                        {expandedRec === 'Carbs' && (
                          <div>
                            <div className="font-semibold text-cyan-300 mb-1">Carbs — fill the remainder</div>
                            <div className="mb-2">
                              <strong className="text-white">{recommendedTargets.carbs} g/day</strong> = (kcal − protein·4 − fat·9) / 4. No fixed g/kg needed once protein and fat floors are met. Higher carbs drive training performance, glycogen replenishment, and insulin/IGF-1 response — all anabolic signals during a bulk.
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div className="rounded p-2 bg-yellow-500/10 border border-yellow-500/20">
                                <div className="text-[10px] font-semibold text-yellow-400 mb-0.5">Under-eating ⤓</div>
                                <div className="text-[10px] text-white/60">Depleted glycogen → weak training, reduced power output, elevated cortisol, blunted IGF-1/mTOR signaling. Sleep can suffer at very low intakes. Thyroid output drops if chronic.</div>
                              </div>
                              <div className="rounded p-2 bg-orange-500/10 border border-orange-500/20">
                                <div className="text-[10px] font-semibold text-orange-400 mb-0.5">Over-eating ⤒</div>
                                <div className="text-[10px] text-white/60">Surplus carbs in excess of glycogen capacity get converted to fat (slowly, but it adds up). Glucose excursions stress the CGM / pancreas. Can crowd out fat → hormonal cost.</div>
                              </div>
                            </div>
                            <div className="text-white/40 text-[10px]">
                              <strong className="text-white/60">Sources:</strong> Burke et al. <em>Carbohydrates for training and competition</em> (J Sports Sci, 2011) · Vandenbogaerde & Hopkins meta-analysis on CHO and endurance/strength performance (Sports Med, 2011) · Helms (MASS).
                            </div>
                          </div>
                        )}
                        {expandedRec === 'Fat' && (
                          <div>
                            <div className="font-semibold text-cyan-300 mb-1">Fat — 25% of total kcal</div>
                            <div className="mb-2">
                              <strong className="text-white">{recommendedTargets.fat} g/day</strong> = 25% of total kcal ÷ 9. Floor is 0.8–1.0 g/kg bodyweight to keep testosterone, recovery, and absorption of fat-soluble vitamins (A, D, E, K) intact. Going below this floor consistently degrades hormonal markers.
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-2">
                              <div className="rounded p-2 bg-yellow-500/10 border border-yellow-500/20">
                                <div className="text-[10px] font-semibold text-yellow-400 mb-0.5">Under-eating ⤓</div>
                                <div className="text-[10px] text-white/60">Testosterone drops 10–15% (relevant even on TRT — affects free T metabolism). Poor absorption of vitamins A/D/E/K. Dry skin, joint stiffness, lower satiety, longer post-workout recovery.</div>
                              </div>
                              <div className="rounded p-2 bg-orange-500/10 border border-orange-500/20">
                                <div className="text-[10px] font-semibold text-orange-400 mb-0.5">Over-eating ⤒</div>
                                <div className="text-[10px] text-white/60">No acute harm — fat is the most calorie-dense macro so easy to over-shoot kcal. Crowds out carbs (performance) and protein (recovery). High-saturated diets long-term can shift lipid profile.</div>
                              </div>
                            </div>
                            <div className="text-white/40 text-[10px]">
                              <strong className="text-white/60">Sources:</strong> Volek et al. <em>Testosterone and cortisol response to dietary fat</em> (J Appl Physiol, 1997) · Lyle McDonald, <em>The Stubborn Fat Solution</em> + <em>Body Recomposition</em> · Andy Galpin lectures on hormonal effects of low-fat diets.
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Target macros — editable */}
                <div className="mb-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[9px] text-white/20 uppercase tracking-wider">Target <span className="text-white/10">(tap to edit)</span></div>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 p-2 rounded-xl bg-white/5">
                    <MacroTarget label="Kcal" value={targets.kcal} onChange={v => updateTarget('kcal', v)} unit="" color="#b90a0a" />
                    <MacroTarget label="Protein" value={targets.protein} onChange={v => updateTarget('protein', v)} unit="g" color="#3b82f6" />
                    <MacroTarget label="Carbs" value={targets.carbs} onChange={v => updateTarget('carbs', v)} unit="g" color="#f59e0b" />
                    <MacroTarget label="Fat" value={targets.fat} onChange={v => updateTarget('fat', v)} unit="g" color="#10b981" />
                  </div>
                </div>

                {/* Actual macros — computed from meals */}
                <div className="mb-3">
                  <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Actual</div>
                  <div className="grid grid-cols-4 gap-1.5 p-2 rounded-xl bg-white/5">
                    {[
                      { label: 'Kcal', actual: actualMacros.kcal, target: targets.kcal, unit: '', color: '#b90a0a' },
                      { label: 'Protein', actual: actualMacros.protein, target: targets.protein, unit: 'g', color: '#3b82f6' },
                      { label: 'Carbs', actual: actualMacros.carbs, target: targets.carbs, unit: 'g', color: '#f59e0b' },
                      { label: 'Fat', actual: actualMacros.fat, target: targets.fat, unit: 'g', color: '#10b981' },
                    ].map(m => {
                      const pct = m.target > 0 ? Math.round((m.actual / m.target - 1) * 100) : 0;
                      const statusColor = Math.abs(pct) <= 5 ? 'text-green-400' : pct < -5 ? 'text-yellow-400' : 'text-red-400';
                      return (
                        <div key={m.label} className="p-1.5 min-w-0">
                          <div className="flex items-center gap-1 mb-0.5">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                            <span className="text-[10px] text-white/40 truncate">{m.label}</span>
                          </div>
                          <div className="flex items-baseline gap-0.5">
                            <span className={`text-base font-bold tabular-nums ${statusColor}`}>{m.actual}</span>
                            {m.unit && <span className="text-[9px] text-white/30">{m.unit}</span>}
                          </div>
                          {pct !== 0 && (
                            <div className={`text-[9px] truncate ${statusColor}`}>{pct > 0 ? '+' : ''}{pct}%</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}

          {/* Meals */}
          {!editing ? (
            <div>
              {(() => {
                // Intra-workout meal needs different targets — gut tolerance limits
                // protein (EAA/BCAA only), no fat (slows gastric emptying), 30-50g carbs.
                const isIntra = (name: string) => {
                  const l = name.toLowerCase();
                  return l.includes('during workout') || l.includes('intra');
                };
                const INTRA_TARGETS = { kcal: 230, protein: 10, carbs: 40, fat: 0 };

                // Real meals split the daily target equally
                const realMeals = plan.meals.filter(m => {
                  const l = m.name.toLowerCase();
                  return !isIntra(m.name) && !l.includes('empty stomach');
                });
                const mealCount = realMeals.length || 1;
                // Subtract intra targets from daily so real meals split the remainder
                const intraDaily = plan.meals.some(m => isIntra(m.name)) ? INTRA_TARGETS : { kcal: 0, protein: 0, carbs: 0, fat: 0 };
                const remaining = {
                  kcal: targets.kcal - intraDaily.kcal,
                  protein: targets.protein - intraDaily.protein,
                  carbs: targets.carbs - intraDaily.carbs,
                  fat: targets.fat - intraDaily.fat,
                };
                const avg = { kcal: Math.round(remaining.kcal / mealCount), protein: Math.round(remaining.protein / mealCount), carbs: Math.round(remaining.carbs / mealCount), fat: Math.round(remaining.fat / mealCount) };
                return plan.meals.map((meal, i) => (
                  <MealCard key={i} meal={meal} allowedFoods={allowedFoods}
                    avgTargets={isIntra(meal.name) ? INTRA_TARGETS : avg}
                    dailyEAAPerMeal={suppByMealName[meal.name] || []}
                    woSupplement={liveWO}
                    onSaveOptimized={onSaveOptimizedMeal ? (m) => onSaveOptimizedMeal(i, m) : undefined} />
                ));
              })()}
              <div className="flex justify-end mt-3 gap-3 items-center">
                <button onClick={(e) => { e.stopPropagation(); handlePrintPlan(); }} className={PRINT_BTN_CLASS} title="Print meal plan as PDF">
                  Print
                </button>
                <button onClick={(e) => { e.stopPropagation(); onStartEdit(); }} className="text-xs text-white/40 hover:text-white/60 uppercase tracking-wider">
                  Edit Plan
                </button>
              </div>
            </div>
          ) : (
            <div>
              {plan.meals.map((meal, mealIdx) => (
                <div key={mealIdx} className="mb-4 p-3 rounded-xl bg-white/5">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text" className="glass-input flex-1 text-sm font-semibold"
                      value={meal.name} onChange={e => updateMealName(mealIdx, e.target.value)}
                      placeholder="Meal name"
                    />
                    <input
                      type="text" className="glass-input flex-1 text-xs"
                      value={meal.subtitle || ''} onChange={e => updateMealSubtitle(mealIdx, e.target.value)}
                      placeholder="subtitle (optional)"
                    />
                    <button onClick={() => removeMeal(mealIdx)} className="text-red-400/60 hover:text-red-400 text-xs px-2">x</button>
                  </div>

                  <label className="text-[10px] text-white/25 uppercase block mb-1">Foods</label>
                  {meal.items.map((item, itemIdx) => {
                    const hasMacros = item.kcal != null && item.kcal > 0;
                    return (
                    <div key={itemIdx} className="mb-1.5">
                      <div className="flex gap-1.5">
                        <input
                          type="text" className="glass-input flex-[2] text-sm"
                          value={item.name} onChange={e => updateMealItemName(mealIdx, itemIdx, e.target.value)}
                          placeholder="Food name"
                        />
                        <input
                          type="text" className="glass-input w-24 text-sm text-right pr-2"
                          value={item.amount || ''} onChange={e => updateMealItemAmount(mealIdx, itemIdx, e.target.value)}
                          placeholder="Amount"
                        />
                        {(
                          <button onClick={() => removeMealItem(mealIdx, itemIdx)} className="text-red-400/40 hover:text-red-400 px-1.5 text-xs">x</button>
                        )}
                      </div>
                      {hasMacros && (
                        <div className="text-[10px] text-white/25 mt-0.5 ml-1">
                          {item.kcal} kcal · {item.protein}p · {item.carbs}c · {item.fat}f
                        </div>
                      )}
                    </div>
                    );
                  })}
                  <button onClick={() => addMealItem(mealIdx)} className="text-[11px] text-white/30 hover:text-white/50 mt-1">+ Add food</button>

                  {/* Supplements */}
                  {(meal.supplements && meal.supplements.length > 0 || true) && (
                    <div className="mt-2">
                      <label className="text-[10px] text-white/25 uppercase block mb-1">Supplements</label>
                      {(meal.supplements || []).map((sup, supIdx) => {
                        const parts = getSupParts(mealIdx, supIdx, sup);
                        const sm = lookupSupplement(sup);
                        const hasMacros = sm && (sm.kcal > 0 || sm.fat > 0 || sm.protein > 0);
                        return (
                        <div key={supIdx} className="mb-1.5">
                          <div className="flex gap-1.5">
                            <input
                              type="text" className="glass-input flex-[2] text-sm"
                              value={parts.name}
                              onChange={e => updateSupplementField(mealIdx, supIdx, 'name', e.target.value)}
                              placeholder="Supplement name"
                            />
                            <input
                              type="text" className="glass-input w-24 text-sm text-right pr-2"
                              value={parts.amount}
                              onChange={e => updateSupplementField(mealIdx, supIdx, 'amount', e.target.value)}
                              placeholder="Amount"
                            />
                            <button onClick={() => removeSupplement(mealIdx, supIdx)} className="text-red-400/40 hover:text-red-400 px-1.5 text-xs">x</button>
                          </div>
                          {hasMacros && (
                            <div className="text-[10px] text-white/25 mt-0.5 ml-1">
                              {sm.kcal} kcal · {sm.protein}p · {sm.carbs}c · {sm.fat}f
                            </div>
                          )}
                        </div>
                        );
                      })}
                      <button onClick={() => addSupplement(mealIdx)} className="text-[11px] text-white/30 hover:text-white/50">+ Add supplement</button>
                    </div>
                  )}
                </div>
              ))}

              <button onClick={addMeal} className="text-xs text-va-red hover:text-va-red-light mb-4">+ Add Meal</button>

              <div className="flex gap-3 mt-2">
                <button onClick={onSave} className="btn-primary text-sm px-4 py-2">Save</button>
                <button onClick={onCancel} className="text-sm px-4 py-2 rounded-xl border border-white/20 bg-white/10 text-white/80 hover:bg-white/20 transition-all">Cancel</button>
              </div>
            </div>
          )}
    </div>
  );
}

export default function NutritionPlanPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editingDay, setEditingDay] = useState<'training' | 'rest' | null>(null);
  const [editPlan, setEditPlan] = useState<DayPlan | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [phase, setPhase] = useState<Phase>('bulking');
  // EAA data read from localStorage (written by DailyEAAPanel, no re-render loop)
  const [showFoodPrefs, setShowFoodPrefs] = useState(false);
  const [allowedFoods, setAllowedFoods] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try { const stored = localStorage.getItem('nnu_allowed_foods'); if (stored) return JSON.parse(stored); } catch {}
    }
    return DEFAULT_OPTIMIZER_FOODS;
  });
  // EAA supplement grouping mode:
  //   '1'         = single shared mix (simplest)
  //   '2-auto'    = 2 mixes, optimal pairing chosen by the app
  //   '2-manual'  = 2 mixes, user assigns each meal to Mix A or Mix B
  //   'per-meal'  = one mix per main meal
  const [eaaGroupMode, setEaaGroupModeState] = useState<EAAGroupMode>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('eaa_group_mode');
      if (v === '1' || v === '2-auto' || v === '2-manual' || v === 'per-meal') return v;
      // Migrate from old `eaa_group_count` numeric setting.
      const c = localStorage.getItem('eaa_group_count');
      if (c) {
        const n = parseInt(c, 10);
        if (n === 1) return '1';
        if (n === 2) return '2-auto';
        if (n >= 3) return 'per-meal';
      }
    }
    return '1';
  });
  // meal-name → group-index assignment used only when mode = '2-manual'.
  const [eaaManualGroups, setEaaManualGroupsState] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      try { const s = localStorage.getItem('eaa_manual_groups'); if (s) return JSON.parse(s); } catch {}
    }
    return {};
  });
  const setEaaGroupMode = (m: EAAGroupMode) => {
    setEaaGroupModeState(m);
    try {
      localStorage.setItem('eaa_group_mode', m);
      saveSetting('eaa_group_mode', m);
    } catch {}
  };
  const setEaaManualGroups = (next: Record<string, number>) => {
    setEaaManualGroupsState(next);
    try {
      const json = JSON.stringify(next);
      localStorage.setItem('eaa_manual_groups', json);
      saveSetting('eaa_manual_groups', json);
    } catch {}
  };
  // Sync from Firestore on mount.
  useEffect(() => {
    getSettingRemote('eaa_group_mode').then(v => {
      if (v === '1' || v === '2-auto' || v === '2-manual' || v === 'per-meal') setEaaGroupModeState(v);
    });
    getSettingRemote('eaa_manual_groups').then(v => {
      if (!v) return;
      try { setEaaManualGroupsState(JSON.parse(v)); } catch {}
    });
  }, []);
  // Always pull latest from Firestore on mount (was only loading if localStorage
  // was empty — so a stale cached list on one device would override the real
  // saved selection from another device, silently reverting edits).
  const allowedFoodsEditedRef = useRef(false);
  useEffect(() => {
    getSettingRemote('nnu_allowed_foods').then(v => {
      if (!v || allowedFoodsEditedRef.current) return;
      try {
        const parsed = JSON.parse(v);
        setAllowedFoods(parsed);
        localStorage.setItem('nnu_allowed_foods', v);
      } catch {}
    });
  }, []);

  const toggleFood = (food: string) => {
    allowedFoodsEditedRef.current = true;
    const next = allowedFoods.includes(food) ? allowedFoods.filter(f => f !== food) : [...allowedFoods, food];
    setAllowedFoods(next);
    const json = JSON.stringify(next);
    localStorage.setItem('nnu_allowed_foods', json);
    saveSetting('nnu_allowed_foods', json);
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      // Load measurements + phase for recommended-macros calculation
      getMeasurements().then(setMeasurements);
      getSetting('phase').then(v => { if (v === 'bulking' || v === 'cutting') setPhase(v); });

      // Load EAA data from Firestore if not in localStorage
      if (typeof window !== 'undefined' && !localStorage.getItem('eaa_g_per_day')) {
        getSetting('eaa_g_per_day').then(v => { if (v) localStorage.setItem('eaa_g_per_day', v); });
        getSetting('eaa_per_meal').then(v => { if (v) localStorage.setItem('eaa_per_meal', v); });
        getSetting('eaa_wo_supplement').then(v => { if (v) localStorage.setItem('eaa_wo_supplement', v); });
      }

      getNutritionPlan().then(async stored => {
        if (stored && 'current' in stored) {
          const p = stored as NutritionPlan;
          setPlan(p);
        } else {
          const defaultVersion = getDefaultNutritionPlan();
          const newPlan: NutritionPlan = { current: defaultVersion, history: [] };
          setPlan(newPlan);
          const remoteExists = await nutritionPlanExistsRemotely();
          if (!remoteExists) {
            await saveNutritionPlan(newPlan);
          }
        }
        setLoaded(true);
      });

      // Also pull directly from Firestore — the IDB cache may be stale on
      // other devices or when background sync hasn't completed yet.
      // This overrides state if remote is newer by lastModified.
      (async () => {
        try {
          const { getDoc, doc } = await import('firebase/firestore');
          const { db } = await import('@/lib/firebase');
          const snap = await getDoc(doc(db, 'nutrition', 'plan'));
          if (!snap.exists()) return;
          const remote = snap.data() as NutritionPlan & { lastModified?: number };
          if (!('current' in remote)) return;
          setPlan(prev => {
            if (!prev) return remote;
            const prevTs = (prev as NutritionPlan & { lastModified?: number }).lastModified || 0;
            const remoteTs = remote.lastModified || 0;
            return remoteTs > prevTs ? remote : prev;
          });
        } catch (e) {
          console.warn('Direct Firestore nutrition fetch failed:', e);
        }
      })();
    }
  }, [isAuthenticated]);

  const persist = useCallback(async (updated: NutritionPlan) => {
    // Recompute macros (food + EAA) so dashboard always matches
    const foodMacros = sumMacros(updated.current.trainingDay.meals);
    let eaaG = typeof window !== 'undefined' ? parseFloat(localStorage.getItem('eaa_g_per_day') || '0') : 0;
    // If EAA not in localStorage, try Firestore
    if (eaaG === 0) {
      try { const v = await getSetting('eaa_g_per_day'); if (v) { eaaG = parseFloat(v); localStorage.setItem('eaa_g_per_day', v); } } catch {}
    }
    updated.current.trainingDay.macros = {
      kcal: foodMacros.kcal + Math.round(eaaG * 4),
      protein: foodMacros.protein + Math.round(eaaG),
      carbs: foodMacros.carbs,
      fat: foodMacros.fat,
    };
    // Compute rest day macros from its own meals (don't copy from training day)
    const restFoodMacros = sumMacros(updated.current.restDay.meals);
    updated.current.restDay.macros = {
      kcal: restFoodMacros.kcal + Math.round(eaaG * 4),
      protein: restFoodMacros.protein + Math.round(eaaG),
      carbs: restFoodMacros.carbs,
      fat: restFoodMacros.fat,
    };
    setPlan(updated);
    await saveNutritionPlan(updated);
  }, []);

  // Save an optimized meal (from NNU optimizer)
  const saveOptimizedMeal = useCallback(async (mealIdx: number, meal: NutritionMeal) => {
    if (!plan) return;
    const meals = plan.current.trainingDay.meals.map((m, i) => i === mealIdx ? meal : m);
    await persist({ ...plan, current: { ...plan.current, trainingDay: { ...plan.current.trainingDay, meals } } });
  }, [plan, persist]);

  const startEdit = (day: 'training' | 'rest') => {
    if (!plan) return;
    const source = day === 'training' ? plan.current.trainingDay : plan.current.restDay;
    const clone: DayPlan = JSON.parse(JSON.stringify(source));
    clone.meals = clone.meals.map(m => ({
      ...m,
      items: m.items.map((item: FoodItem | string) => parseFoodItem(item)),
    }));
    setEditPlan(clone);
    setEditingDay(day);
  };

  const cancelEdit = () => {
    setEditingDay(null);
    setEditPlan(null);
  };

  const saveEdit = async () => {
    if (!plan || !editPlan || !editingDay) return;

    // Archive current version
    const archivedVersion: NutritionPlanVersion = {
      ...plan.current,
      endDate: new Date().toISOString().split('T')[0],
    };

    // Create new version
    const newVersion: NutritionPlanVersion = {
      ...plan.current,
      id: Date.now().toString(),
      startDate: new Date().toISOString().split('T')[0],
      endDate: undefined,
    };

    const allMeals = [...editPlan.meals];
    const computed = sumMacros(allMeals);
    const savedPlan = { ...editPlan, meals: allMeals, macros: computed };

    if (editingDay === 'training') {
      newVersion.trainingDay = savedPlan;
    } else {
      newVersion.restDay = savedPlan;
    }

    await persist({
      current: newVersion,
      history: [archivedVersion, ...plan.history],
    });

    setEditingDay(null);
    setEditPlan(null);
  };

  if (isLoading || !isAuthenticated || !loaded) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
          <div className="max-w-3xl mx-auto flex items-center justify-center min-h-[60vh]">
            <div className="text-white/40 text-lg">Loading...</div>
          </div>
        </main>
      </div>
    );
  }

  if (!plan) return null;

  // Science-based recommended macros — same TDEE math as Energy Balance card
  const latestWeight = measurements.length > 0 ? measurements[measurements.length - 1].weight : null;
  // Compute live intake from items + macro-bearing supplements + daily EAA
  // (avoids the stored plan.macros header which can go stale between edits).
  const foodSum = sumMacros(plan.current.trainingDay.meals);
  const isExcludedFromEAA = (n: string) => {
    const l = n.toLowerCase();
    return l.includes('during workout') || l.includes('intra') || l.includes('after workout');
  };
  const mainsForEAAEntries = plan.current.trainingDay.meals
    .filter(m => !isExcludedFromEAA(m.name))
    .map(meal => ({
      name: meal.name,
      foods: meal.items
        .map(it => { try { return parseFoodItem(it); } catch { return { name: '' }; } })
        .filter(it => it.name.trim() && it.amount)
        .map(f => ({ name: f.name, amount: f.amount as string })),
    }))
    .filter(m => m.foods.length > 0);
  const liveEAAParams = deriveGroupingParams(eaaGroupMode, eaaManualGroups, mainsForEAAEntries.map(m => m.name));
  const liveEAAGroups = mainsForEAAEntries.length > 0
    ? calcGroupedEAA(mainsForEAAEntries.map(m => m.foods), mainsForEAAEntries.map(m => m.name), liveEAAParams.groupCount, undefined, 2, liveEAAParams.manualPartition)
    : [];
  const eaaTotalMg = liveEAAGroups.reduce((s, g) => s + g.supplement.totalPerDay, 0);
  const eaaDailyKcal = Math.round(eaaTotalMg * 4 / 1000);
  const dailyPlanKcal = foodSum.kcal + eaaDailyKcal;
  const wkIntake = calcWeeklyIntake(dailyPlanKcal, plan.current.trainingDay.meals).weeklyAvgKcal;
  const derived = measurements.length >= 2 ? calcDerivedTDEE(measurements, wkIntake, 28) : null;
  const recommended = (latestWeight && derived) ? calcRecommendedMacros(latestWeight, derived.tdee, phase) : null;

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-4">Nutrition</h1>

          {/* Training Day */}
          <div className="mb-4">
            <DayPlanView
              dayPlan={plan.current.trainingDay}
              title="Training Day"
              color="#22c55e"
              editing={editingDay === 'training'}
              onStartEdit={() => startEdit('training')}
              onSave={saveEdit}
              onCancel={cancelEdit}
              editPlan={editingDay === 'training' ? editPlan : null}
              setEditPlan={setEditPlan}
              allowedFoods={allowedFoods}
              onSaveOptimizedMeal={saveOptimizedMeal}
              recommendedTargets={recommended}
              eaaGroupMode={eaaGroupMode}
              eaaManualGroups={eaaManualGroups}
            />
          </div>

          {/* Auto-Optimize */}
          <AutoOptimizePanel plan={plan} allowedFoods={allowedFoods} persist={persist} />

          {/* Per-meal EAA breakdown — collapsible */}
          <EAAOverviewPanel plan={plan} allowedFoods={allowedFoods} groupMode={eaaGroupMode} manualGroups={eaaManualGroups} />

          {/* Daily EAA Supplement Summary — computed lazily */}
          <DailyEAAPanel
            plan={plan}
            allowedFoods={allowedFoods}
            groupMode={eaaGroupMode}
            setGroupMode={setEaaGroupMode}
            manualGroups={eaaManualGroups}
            setManualGroups={setEaaManualGroups}
          />

          {/* NNU Food Preferences */}
          <div className="mb-6">
            <button
              onClick={() => setShowFoodPrefs(!showFoodPrefs)}
              className="text-xs text-white/30 hover:text-white/50 uppercase tracking-wider flex items-center gap-2"
            >
              <span className={`transition-transform duration-200 ${showFoodPrefs ? 'rotate-90' : ''}`}>&#9654;</span>
              NNU Optimizer Foods ({allowedFoods.length} selected)
            </button>
            {showFoodPrefs && (
              <div className="mt-3 glass-card p-4">
                {Object.entries(
                  ALL_OPTIMIZER_FOODS.reduce((acc, f) => {
                    (acc[f.category] = acc[f.category] || []).push(f);
                    return acc;
                  }, {} as Record<string, typeof ALL_OPTIMIZER_FOODS>)
                ).map(([category, foods]) => (
                  <div key={category} className="mb-3">
                    <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">{category}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {foods.map(f => {
                        const active = allowedFoods.includes(f.food);
                        return (
                          <button key={f.food} onClick={() => toggleFood(f.food)}
                            className={`text-xs px-2.5 py-1 rounded-lg transition-all ${active ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-white/30 border border-white/5 hover:border-white/15'}`}>
                            {f.food.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Version History */}
          {plan.history.length > 0 && (
            <div className="mb-8">
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="text-xs text-white/30 hover:text-white/50 uppercase tracking-wider flex items-center gap-2"
              >
                <span className={`transition-transform duration-200 ${showHistory ? 'rotate-90' : ''}`}>&#9654;</span>
                Previous versions ({plan.history.length})
              </button>

              {showHistory && (
                <div className="mt-3 space-y-2">
                  {plan.history.map((version, idx) => (
                    <div key={version.id || idx} className="glass-card p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs text-white/40">
                            {version.startDate} → {version.endDate || 'current'}
                          </span>
                          <div className="text-xs text-white/30 mt-1">
                            {version.trainingDay.macros.kcal} kcal · {version.trainingDay.meals.length} meals
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            if (!confirm('Restore this version? Current plan will be saved to history.')) return;
                            const archived = { ...plan.current, endDate: new Date().toISOString().split('T')[0] };
                            await persist({
                              current: { ...version, endDate: undefined },
                              history: [archived, ...plan.history.filter((_, i) => i !== idx)],
                            });
                          }}
                          className="text-[10px] text-cyan-400/60 hover:text-cyan-400 uppercase tracking-wider"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
