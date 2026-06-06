/**
 * EAA (Essential Amino Acid) database and NNU (Net Nitrogen Utilization) calculator.
 *
 * MAP (Master Amino Acid Pattern) = ideal EAA ratio for 99% NNU.
 * NNU% = min(actual_pct / MAP_pct) across all 9 EAAs.
 * The limiting amino acid determines how much dietary protein the body actually uses.
 *
 * Key insight: no single natural food has isoleucine ≥14.8% of total EAAs,
 * so meals limited by isoleucine (the most common case) cannot reach >~85% NNU
 * with food alone. A targeted EAA supplement is needed to reach >95%.
 */

import { FOODS, PIECE_G, type EAA, type EAAProfile } from './foods';
export type { EAA, EAAProfile } from './foods';

export const EAA_NAMES: Record<EAA, string> = {
  leu: 'Leucine', ile: 'Isoleucine', val: 'Valine', lys: 'Lysine',
  phe: 'Phenylalanine', thr: 'Threonine', met: 'Methionine', trp: 'Tryptophan', his: 'Histidine',
};
export const EAA_ORDER: EAA[] = ['leu', 'ile', 'val', 'lys', 'phe', 'thr', 'met', 'trp', 'his'];

// MAP ratios (%) — target for 99% NNU
export const MAP: Record<EAA, number> = {
  leu: 19.6, ile: 14.8, val: 16.6, lys: 14.3, phe: 12.9,
  thr: 11.1, met: 7.0, trp: 2.6, his: 1.1,
};

// Derived maps from the unified FOODS DB — single source of truth.
// The legacy const names are kept so the rest of this file (and the
// optimizer's lookupMacro helper) can remain unchanged.
const EAA_DB: Record<string, EAAProfile> = Object.fromEntries(
  Object.entries(FOODS).filter(([, f]) => f.eaa).map(([k, f]) => [k, f.eaa!])
);
const PROTEIN_PER_100G: Record<string, number> = Object.fromEntries(
  Object.entries(FOODS).map(([k, f]) => [k, f.protein])
);
const KCAL_PER_100G: Record<string, number> = Object.fromEntries(
  Object.entries(FOODS).map(([k, f]) => [k, f.kcal])
);
const CARBS_PER_100G: Record<string, number> = Object.fromEntries(
  Object.entries(FOODS).map(([k, f]) => [k, f.carbs])
);
const FAT_PER_100G: Record<string, number> = Object.fromEntries(
  Object.entries(FOODS).map(([k, f]) => [k, f.fat])
);


// ─── Custom food DB (localStorage) ───

export interface CustomFood {
  name: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  eaa: EAAProfile;
}

export function getCustomFoods(): Record<string, CustomFood> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem('custom_foods') || '{}'); } catch { return {}; }
}

export async function loadCustomFoodsFromFirestore(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const { getSetting } = await import('@/utils/storage');
    const v = await getSetting('custom_foods');
    if (v) localStorage.setItem('custom_foods', v);
  } catch {}
}

export function saveCustomFood(food: CustomFood) {
  const all = getCustomFoods();
  all[food.name.toLowerCase().trim()] = food;
  const json = JSON.stringify(all);
  localStorage.setItem('custom_foods', json);
  // Sync to Firestore
  import('@/utils/storage').then(({ saveSetting }) => saveSetting('custom_foods', json)).catch(() => {});
}

export function isKnownFood(name: string): boolean {
  const lower = name.toLowerCase().trim();
  // Check built-in DBs
  if (EAA_DB[lower] || PROTEIN_PER_100G[lower]) return true;
  for (const key of Object.keys(EAA_DB)) {
    if (lower.includes(key) || key.includes(lower)) return true;
  }
  for (const key of Object.keys(PROTEIN_PER_100G)) {
    if (lower.includes(key) || key.includes(lower)) return true;
  }
  // Check custom DB
  const custom = getCustomFoods();
  if (custom[lower]) return true;
  for (const key of Object.keys(custom)) {
    if (lower.includes(key) || key.includes(lower)) return true;
  }
  return false;
}

function parseGrams(amount: string | undefined, name: string): number {
  if (!amount) return 0;
  const safe = (s: string, fb = 0) => { const v = parseFloat(s); return isFinite(v) ? v : fb; };
  const gMatch = amount.match(/([\d.]+)\s*(?:gr?|grams?)$/i);
  if (gMatch) return safe(gMatch[1]);
  const mlMatch = amount.match(/([\d.]+)\s*ml$/i);
  if (mlMatch) return safe(mlMatch[1]);
  // Cups (1 cup ≈ 240ml)
  const cupMatch = amount.match(/([\d.]*)\s*cups?$/i);
  if (cupMatch) return safe(cupMatch[1] || '1', 1) * 240;
  // Tablespoon / teaspoon
  const tbspMatch = amount.match(/([\d.]+)\s*(?:tbsp|tablespoons?)$/i);
  if (tbspMatch) return safe(tbspMatch[1]) * 15;
  const tspMatch = amount.match(/([\d.]+)\s*(?:tsp|teaspoons?)$/i);
  if (tspMatch) return safe(tspMatch[1]) * 5;
  // Scoop (~30g)
  const scoopMatch = amount.match(/([\d.]*)\s*scoops?$/i);
  if (scoopMatch) return safe(scoopMatch[1] || '1', 1) * 30;
  // Bare number — check piece weights
  const bare = amount.match(/^([\d.]+)$/);
  if (bare) {
    const lower = name.toLowerCase().trim();
    const n = safe(bare[1]);
    for (const [k, w] of Object.entries(PIECE_G)) {
      if (lower.includes(k) || k.includes(lower)) return n * w;
    }
    return n;
  }
  return 0;
}

// Longest-match fuzzy lookup: exact key wins; otherwise the most-specific substring match wins
function fuzzyLookup<T>(db: Record<string, T>, name: string): T | null {
  const lower = name.toLowerCase().trim();
  if (db[lower] !== undefined) return db[lower];
  let best: T | null = null;
  let bestLen = 0;
  for (const [key, val] of Object.entries(db)) {
    if ((lower.includes(key) || key.includes(lower)) && key.length > bestLen) {
      best = val;
      bestLen = key.length;
    }
  }
  return best;
}

export function getEAAProfile(name: string): EAAProfile | null {
  // Check custom DB first (longest-match)
  const custom = getCustomFoods();
  const customMatch = fuzzyLookup(custom, name);
  if (customMatch) return customMatch.eaa;
  // Built-in DB
  return fuzzyLookup(EAA_DB, name);
}

function getProteinPer100g(name: string): number {
  const custom = getCustomFoods();
  const customMatch = fuzzyLookup(custom, name);
  if (customMatch) return customMatch.protein;
  const v = fuzzyLookup(PROTEIN_PER_100G, name);
  return v ?? 0;
}

export interface FoodInput { name: string; amount?: string; }

export interface EAAResult {
  totalProtein: number;
  totalEAA: number;
  profile: Record<EAA, number>;
  pcts: Record<EAA, number>;
  nnu: number;
  limiting: EAA;
  gaps: { aa: EAA; need: number }[];
  usedProtein: number;
  wastedProtein: number;
}

/** Calculate the combined EAA profile and NNU for a set of foods */
export function calcNNU(foods: FoodInput[]): EAAResult | null {
  const profile: Record<EAA, number> = { leu: 0, ile: 0, val: 0, lys: 0, phe: 0, thr: 0, met: 0, trp: 0, his: 0 };
  let totalProtein = 0;

  for (const food of foods) {
    const eaa = getEAAProfile(food.name);
    const protPer100 = getProteinPer100g(food.name);
    if (!eaa || !protPer100) continue;
    const grams = parseGrams(food.amount, food.name);
    if (grams <= 0) continue;
    const proteinG = (protPer100 * grams) / 100;
    totalProtein += proteinG;
    for (const aa of EAA_ORDER) profile[aa] += eaa[aa] * proteinG;
  }

  if (totalProtein <= 0) return null;
  const totalEAA = EAA_ORDER.reduce((sum, aa) => sum + profile[aa], 0);
  if (totalEAA <= 0) return null;

  const pcts: Record<EAA, number> = {} as Record<EAA, number>;
  for (const aa of EAA_ORDER) pcts[aa] = (profile[aa] / totalEAA) * 100;

  let minRatio = Infinity;
  let limiting: EAA = 'leu';
  for (const aa of EAA_ORDER) {
    const ratio = pcts[aa] / MAP[aa];
    if (ratio < minRatio) { minRatio = ratio; limiting = aa; }
  }
  const nnu = Math.round(minRatio * 1000) / 10;

  // Calculate gaps: mg of each AA needed to reach 95% NNU
  // We need each AA's pct to be ≥ 0.95 * MAP[aa]
  // Solve: (profile[aa] + add[aa]) / (totalEAA + sum(add)) ≥ 0.95 * MAP[aa] / 100
  // Approximate by computing how much pure AA to add for each deficient one
  const targetRatio = 0.95;
  const gaps: { aa: EAA; need: number }[] = [];
  for (const aa of EAA_ORDER) {
    const ratio = pcts[aa] / MAP[aa];
    if (ratio < targetRatio) {
      // Approximate: need_mg ≈ totalEAA * (targetRatio * MAP[aa]/100 - pcts[aa]/100)
      const need = totalEAA * (targetRatio * MAP[aa] / 100 - pcts[aa] / 100);
      if (need > 5) gaps.push({ aa, need: Math.round(need) });
    }
  }
  gaps.sort((a, b) => b.need - a.need);

  const usedProtein = Math.round(totalProtein * (nnu / 100) * 10) / 10;
  const wastedProtein = Math.round((totalProtein - usedProtein) * 10) / 10;

  return { totalProtein: Math.round(totalProtein * 10) / 10, totalEAA: Math.round(totalEAA), profile, pcts, nnu, limiting, gaps, usedProtein, wastedProtein };
}

// ─── Meal optimizer ───

export interface MealChange {
  food: string;
  originalG: number;
  newG: number;
  deltaKcal: number;
}

export interface OptimizedMeal {
  changes: MealChange[];
  additions: { food: string; grams: number; kcal: number }[];
  supplements: { aa: EAA; mg: number }[];
  supplementTotalMg: number;
  originalNNU: number;
  foodOnlyNNU: number;
  finalNNU: number;
  deltaKcal: number;
  deltaProtein: number;
  deltaCarbs: number;
  deltaFat: number;
}

// Full catalog of optimizer foods with reasonable max portions and categories
export interface OptimizerFood { food: string; maxG: number; step: number; category: string }

export const ALL_OPTIMIZER_FOODS: OptimizerFood[] = [
  // Eggs
  { food: 'eggs', maxG: 180, step: 60, category: 'Eggs' },
  { food: 'egg whites', maxG: 200, step: 50, category: 'Eggs' },
  // Dairy
  { food: 'greek yogurt', maxG: 250, step: 50, category: 'Dairy' },
  { food: 'yogurt', maxG: 250, step: 50, category: 'Dairy' },
  { food: 'cottage cheese', maxG: 200, step: 50, category: 'Dairy' },
  { food: 'quark', maxG: 200, step: 50, category: 'Dairy' },
  { food: 'skyr', maxG: 200, step: 50, category: 'Dairy' },
  { food: 'milk', maxG: 300, step: 100, category: 'Dairy' },
  { food: 'kefir', maxG: 300, step: 100, category: 'Dairy' },
  { food: 'mozzarella', maxG: 60, step: 20, category: 'Dairy' },
  { food: 'feta', maxG: 60, step: 20, category: 'Dairy' },
  { food: 'ricotta', maxG: 100, step: 50, category: 'Dairy' },
  { food: 'gouda', maxG: 40, step: 20, category: 'Dairy' },
  { food: 'parmesan', maxG: 30, step: 10, category: 'Dairy' },
  { food: 'cream cheese', maxG: 40, step: 20, category: 'Dairy' },
  // Protein powders
  { food: 'whey', maxG: 40, step: 10, category: 'Protein Powder' },
  { food: 'whey isolate', maxG: 40, step: 10, category: 'Protein Powder' },
  { food: 'casein', maxG: 40, step: 10, category: 'Protein Powder' },
  { food: 'pea protein', maxG: 30, step: 10, category: 'Protein Powder' },
  { food: 'collagen', maxG: 20, step: 10, category: 'Protein Powder' },
  // Poultry
  { food: 'chicken breast', maxG: 200, step: 50, category: 'Poultry' },
  { food: 'chicken thigh', maxG: 150, step: 50, category: 'Poultry' },
  { food: 'turkey breast', maxG: 200, step: 50, category: 'Poultry' },
  { food: 'duck', maxG: 150, step: 50, category: 'Poultry' },
  // Meat
  { food: 'beef', maxG: 200, step: 50, category: 'Meat' },
  { food: 'steak', maxG: 200, step: 50, category: 'Meat' },
  { food: 'ground beef', maxG: 150, step: 50, category: 'Meat' },
  { food: 'bison', maxG: 150, step: 50, category: 'Meat' },
  { food: 'venison', maxG: 150, step: 50, category: 'Meat' },
  { food: 'pork', maxG: 150, step: 50, category: 'Meat' },
  { food: 'pork tenderloin', maxG: 150, step: 50, category: 'Meat' },
  { food: 'lamb', maxG: 150, step: 50, category: 'Meat' },
  { food: 'rabbit', maxG: 150, step: 50, category: 'Meat' },
  { food: 'goat', maxG: 150, step: 50, category: 'Meat' },
  { food: 'liver (beef)', maxG: 100, step: 50, category: 'Meat' },
  { food: 'bacon', maxG: 50, step: 25, category: 'Meat' },
  { food: 'prosciutto', maxG: 50, step: 25, category: 'Meat' },
  // Fish & seafood
  { food: 'salmon', maxG: 200, step: 50, category: 'Fish & Seafood' },
  { food: 'tuna', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'cod', maxG: 200, step: 50, category: 'Fish & Seafood' },
  { food: 'sardines', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'mackerel', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'trout', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'halibut', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'swordfish', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'sea bass', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'tilapia', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'shrimp', maxG: 150, step: 50, category: 'Fish & Seafood' },
  { food: 'scallops', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'crab', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'lobster', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'mussels', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'octopus', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'squid', maxG: 100, step: 50, category: 'Fish & Seafood' },
  { food: 'anchovies', maxG: 50, step: 25, category: 'Fish & Seafood' },
  // Seeds
  { food: 'pumpkin seeds', maxG: 40, step: 10, category: 'Seeds' },
  { food: 'sunflower seeds', maxG: 40, step: 10, category: 'Seeds' },
  { food: 'hemp seeds', maxG: 40, step: 10, category: 'Seeds' },
  { food: 'chia seeds', maxG: 30, step: 10, category: 'Seeds' },
  { food: 'flax seeds', maxG: 30, step: 10, category: 'Seeds' },
  { food: 'sesame seeds', maxG: 30, step: 10, category: 'Seeds' },
  // Nuts
  { food: 'almonds', maxG: 40, step: 10, category: 'Nuts' },
  { food: 'walnuts', maxG: 40, step: 10, category: 'Nuts' },
  { food: 'cashews', maxG: 40, step: 10, category: 'Nuts' },
  { food: 'pistachios', maxG: 40, step: 10, category: 'Nuts' },
  { food: 'pine nuts', maxG: 30, step: 10, category: 'Nuts' },
  { food: 'brazil nuts', maxG: 20, step: 10, category: 'Nuts' },
  { food: 'hazelnuts', maxG: 30, step: 10, category: 'Nuts' },
  { food: 'pecans', maxG: 30, step: 10, category: 'Nuts' },
  { food: 'macadamia nuts', maxG: 30, step: 10, category: 'Nuts' },
  { food: 'peanut butter', maxG: 30, step: 10, category: 'Nuts' },
  { food: 'almond butter', maxG: 30, step: 10, category: 'Nuts' },
  // Legumes
  { food: 'lentils', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'chickpeas', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'black beans', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'kidney beans', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'pinto beans', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'navy beans', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'mung beans', maxG: 100, step: 50, category: 'Legumes' },
  { food: 'edamame', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'tofu', maxG: 150, step: 50, category: 'Legumes' },
  { food: 'tempeh', maxG: 100, step: 50, category: 'Legumes' },
  { food: 'soy milk', maxG: 300, step: 100, category: 'Legumes' },
  // Grains
  { food: 'quinoa', maxG: 150, step: 50, category: 'Grains' },
  { food: 'buckwheat', maxG: 150, step: 50, category: 'Grains' },
  { food: 'amaranth', maxG: 100, step: 50, category: 'Grains' },
  { food: 'spelt', maxG: 100, step: 50, category: 'Grains' },
  { food: 'millet', maxG: 100, step: 50, category: 'Grains' },
  { food: 'oats', maxG: 100, step: 25, category: 'Grains' },
  { food: 'barley', maxG: 100, step: 50, category: 'Grains' },
  // Vegetables
  { food: 'peas', maxG: 100, step: 50, category: 'Vegetables' },
  { food: 'broccoli', maxG: 150, step: 50, category: 'Vegetables' },
  { food: 'spinach', maxG: 100, step: 50, category: 'Vegetables' },
  { food: 'asparagus', maxG: 100, step: 50, category: 'Vegetables' },
  { food: 'mushrooms', maxG: 100, step: 50, category: 'Vegetables' },
  // Superfoods
  { food: 'spirulina', maxG: 10, step: 5, category: 'Superfoods' },
  { food: 'chlorella', maxG: 10, step: 5, category: 'Superfoods' },
  { food: 'nutritional yeast', maxG: 20, step: 5, category: 'Superfoods' },
  { food: 'bee pollen', maxG: 15, step: 5, category: 'Superfoods' },
];

// Default selection: practical bodybuilding foods
export const DEFAULT_OPTIMIZER_FOODS = [
  'eggs', 'egg whites', 'cottage cheese', 'quark', 'whey', 'greek yogurt', 'yogurt',
  'chicken breast', 'tuna', 'shrimp', 'salmon', 'cod',
  'pumpkin seeds', 'hemp seeds', 'almonds',
  'oats',
  'lentils', 'tofu', 'edamame',
  'spirulina',
];

// Shared fuzzy macro lookup (longest-match)
function lookupMacro(db: Record<string, number>, name: string): number {
  if (db[name] !== undefined) return db[name];
  let best = 0;
  let bestLen = 0;
  for (const [k, v] of Object.entries(db)) {
    if ((name.includes(k) || k.includes(name)) && k.length > bestLen) {
      best = v;
      bestLen = k.length;
    }
  }
  return best;
}

function foodKcal(food: string, grams: number): number {
  return Math.round((KCAL_PER_100G[food] || 200) * grams / 100);
}

function formatFood(food: string, grams: number): string {
  if (food === 'eggs' || food === 'egg') {
    const count = Math.round(grams / 60);
    return count === 1 ? '1 Egg' : `${count} Eggs`;
  }
  return `${grams}g ${food.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')}`;
}

/**
 * Solve for targeted AA supplements: closed-form with iterative expansion.
 */
function calcTargetedAAs(profile: Record<EAA, number>, targetNNU: number): { aas: { aa: EAA; mg: number }[]; totalMg: number; newNNU: number } | null {
  const alpha = targetNNU / 100;
  const T = EAA_ORDER.reduce((s, aa) => s + profile[aa], 0);
  if (T <= 0) return null;

  let D = EAA_ORDER.filter(aa => (profile[aa] / T * 100) / MAP[aa] < alpha);
  if (D.length === 0) return null;
  let addMap: Record<string, number> = {};

  for (let round = 0; round < 10; round++) {
    const M = D.reduce((s, aa) => s + MAP[aa], 0) / 100;
    const P = D.reduce((s, aa) => s + profile[aa], 0);
    const denom = 1 - alpha * M;
    if (denom <= 0.001) return null;
    const S = (alpha * T * M - P) / denom;
    if (S < 0 || !isFinite(S)) return null;

    addMap = {};
    for (const aa of D) {
      const need = alpha * MAP[aa] / 100 * (T + S) - profile[aa];
      if (need > 0) addMap[aa] = need;
    }

    let expanded = false;
    for (const aa of EAA_ORDER) {
      if (D.includes(aa)) continue;
      if ((profile[aa] / (T + S) * 100) / MAP[aa] < alpha) {
        D = [...D, aa];
        expanded = true;
      }
    }
    if (!expanded) break;
  }

  const aas: { aa: EAA; mg: number }[] = [];
  let totalMg = 0;
  for (const aa of EAA_ORDER) {
    if ((addMap[aa] || 0) > 5) {
      const rounded = Math.ceil(addMap[aa] / 50) * 50;
      aas.push({ aa, mg: rounded });
      totalMg += rounded;
    }
  }
  if (aas.length === 0) return null;

  const vp = { ...profile };
  for (const { aa, mg } of aas) vp[aa] += mg;
  const vT = EAA_ORDER.reduce((s, aa) => s + vp[aa], 0);
  let vMin = Infinity;
  for (const aa of EAA_ORDER) {
    const r = (vp[aa] / vT * 100) / MAP[aa];
    if (r < vMin) vMin = r;
  }
  return { aas, totalMg, newNNU: Math.round(vMin * 1000) / 10 };
}

/**
 * Optimize a meal for >95% NNU:
 *  1. Reduce excess-AA foods (high Leu/Lys) to free up calories
 *  2. Add complementary foods (high Ile/Val/Met) using freed calories
 *  3. Close remaining gap with targeted AA supplements
 */
// Aggressiveness presets: level 1 (conservative) to 5 (extreme)
const AGGRESSIVENESS = [
  { reduceFoods: 2, reductionFactors: [0.85],             maxAdditions: 1, maxKcalDelta: 100, searchCap: 200  },  // 1
  { reduceFoods: 3, reductionFactors: [0.8, 0.7],         maxAdditions: 2, maxKcalDelta: 200, searchCap: 400  },  // 2
  { reduceFoods: 4, reductionFactors: [0.8, 0.65, 0.5],   maxAdditions: 2, maxKcalDelta: 300, searchCap: 600  },  // 3
  { reduceFoods: 5, reductionFactors: [0.7, 0.5, 0.3],    maxAdditions: 2, maxKcalDelta: 400, searchCap: 800  },  // 4
  { reduceFoods: 6, reductionFactors: [0.6, 0.4, 0.2, 0], maxAdditions: 2, maxKcalDelta: 600, searchCap: 600 }, // 5
];

export function optimizeMeal(foods: FoodInput[], targetNNU: number = 96, allowedFoods?: string[], level: number = 2): OptimizedMeal | null {
  const original = calcNNU(foods);
  if (!original || original.nnu >= targetNNU) return null;

  const agg = AGGRESSIVENESS[Math.max(0, Math.min(4, level - 1))];

  // Compute original meal macros for ±5% constraint
  const origMacros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const f of foods) {
    const name = f.name.toLowerCase().trim();
    const g = parseGrams(f.amount, name);
    if (g <= 0) continue;
    const prot = getProteinPer100g(name);
    const kcal = lookupMacro(KCAL_PER_100G, name);
    const carb = lookupMacro(CARBS_PER_100G, name);
    const fat = lookupMacro(FAT_PER_100G, name);
    origMacros.kcal += kcal * g / 100;
    origMacros.protein += prot * g / 100;
    origMacros.carbs += carb * g / 100;
    origMacros.fat += fat * g / 100;
  }
  origMacros.kcal = Math.round(origMacros.kcal);
  origMacros.protein = Math.round(origMacros.protein);
  origMacros.carbs = Math.round(origMacros.carbs);
  origMacros.fat = Math.round(origMacros.fat);

  // Build candidate list — pre-filter to top 12 foods that best help the limiting AAs
  const allCandidates = (allowedFoods || DEFAULT_OPTIMIZER_FOODS)
    .map(name => ALL_OPTIMIZER_FOODS.find(f => f.food === name))
    .filter((f): f is OptimizerFood => !!f && !!EAA_DB[f.food])
    // Skip foods already in the meal
    .filter(f => !foods.some(mf => {
      const mfn = mf.name.toLowerCase().trim();
      const cfn = f.food;
      // Check both directions + singular/plural
      return mfn.includes(cfn) || cfn.includes(mfn) || mfn.replace(/s$/, '') === cfn.replace(/s$/, '');
    }));

  // Score each candidate by how well its EAA profile addresses the deficient AAs
  const deficientAAs = EAA_ORDER.filter(aa => (original.pcts[aa] / MAP[aa]) < 0.95);
  const scored = allCandidates.map(c => {
    const eaa = EAA_DB[c.food];
    const total = EAA_ORDER.reduce((s, aa) => s + eaa[aa], 0);
    // Score = sum of (pct / MAP) for deficient AAs — higher means this food helps more
    let score = 0;
    for (const aa of deficientAAs) score += (eaa[aa] / total * 100) / MAP[aa];
    return { ...c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, 12);

  // Identify which existing foods have EAA profiles and can be adjusted
  const adjustable: { idx: number; food: string; grams: number; kcalPer100: number }[] = [];
  for (let i = 0; i < foods.length; i++) {
    const name = foods[i].name.toLowerCase().trim();
    const eaa = getEAAProfile(name);
    const prot = getProteinPer100g(name);
    const grams = parseGrams(foods[i].amount, name);
    const kcal = lookupMacro(KCAL_PER_100G, name);
    if (eaa && prot && grams > 0 && kcal) {
      adjustable.push({ idx: i, food: name, grams, kcalPer100: kcal });
    }
  }

  // Score each existing food by how much it pushes NNU DOWN (excess ratio)
  // Foods with high excess in Leu/Lys/His relative to Ile/Val are "waste drivers"
  const wasteScores: { idx: number; score: number }[] = [];
  for (const adj of adjustable) {
    const eaa = getEAAProfile(adj.food)!;
    const total = EAA_ORDER.reduce((s, aa) => s + eaa[aa], 0);
    // Score = sum of (excess over MAP) for all AAs — higher = more wasteful
    let excess = 0;
    for (const aa of EAA_ORDER) {
      const pct = eaa[aa] / total * 100;
      if (pct > MAP[aa]) excess += pct - MAP[aa];
    }
    wasteScores.push({ idx: adj.idx, score: excess });
  }
  wasteScores.sort((a, b) => b.score - a.score);

  // Try many combinations: reduce top waste-drivers by 10-30%, add complementary foods
  type Candidate = {
    changes: MealChange[];
    additions: { food: string; grams: number; kcal: number }[];
    foodList: FoodInput[];
    nnu: number;
    deltaKcal: number;
  };

  const results: Candidate[] = [];

  // Generate reduction options for the top N waste-drivers (controlled by aggressiveness)
  const reductionOptions: { idx: number; factor: number }[][] = [[]]; // start with "no reduction"
  for (const ws of wasteScores.slice(0, agg.reduceFoods)) {
    const adj = adjustable.find(a => a.idx === ws.idx)!;
    const newOptions: typeof reductionOptions = [];
    for (const existing of reductionOptions) {
      newOptions.push(existing);
      for (const factor of agg.reductionFactors) {
        newOptions.push([...existing, { idx: ws.idx, factor }]);
      }
    }
    reductionOptions.length = 0;
    reductionOptions.push(...newOptions);
    // Cap reduction combos to prevent combinatorial explosion
    if (reductionOptions.length > 200) break;
  }

  // For each reduction combo, try adding complementary foods
  for (const reductions of reductionOptions) {
    // Build the reduced food list
    const changes: MealChange[] = [];
    const reducedFoods: FoodInput[] = foods.map((f, i) => {
      const red = reductions.find(r => r.idx === i);
      if (red) {
        const adj = adjustable.find(a => a.idx === i)!;
        const newG = Math.round(adj.grams * red.factor / 5) * 5; // round to 5g
        changes.push({
          food: adj.food,
          originalG: adj.grams,
          newG,
          deltaKcal: foodKcal(adj.food, newG) - foodKcal(adj.food, adj.grams),
        });
        return { name: f.name, amount: `${newG} gr` };
      }
      return f;
    });

    const reductionKcal = changes.reduce((s, c) => s + c.deltaKcal, 0);

    // Try adding 0, 1, or 2 complementary foods
    const addCombos: { food: string; grams: number }[][] = [[]];
    for (const cand of candidates) {
      // Already filtered in pre-filter
      const newCombos: typeof addCombos = [];
      for (const existing of addCombos) {
        newCombos.push(existing);
        if (existing.length < agg.maxAdditions) {
          for (let g = cand.step; g <= cand.maxG; g += cand.step) {
            newCombos.push([...existing, { food: cand.food, grams: g }]);
          }
        }
      }
      addCombos.length = 0;
      addCombos.push(...newCombos);
      if (addCombos.length > agg.searchCap) break;
    }

    for (const additions of addCombos) {
      const addKcal = additions.reduce((s, a) => s + foodKcal(a.food, a.grams), 0);
      const totalDeltaKcal = reductionKcal + addKcal;

      if (totalDeltaKcal > agg.maxKcalDelta) continue;

      // Check macro constraints: ±5% of original meal for kcal, protein, carbs, fat
      if (origMacros.kcal > 0) {
        let newKcal = 0, newProt = 0, newCarbs = 0, newFat = 0;
        for (const c of changes) {
          const diff = c.newG - c.originalG;
          newKcal += foodKcal(c.food, c.newG) - foodKcal(c.food, c.originalG);
          newProt += lookupMacro(PROTEIN_PER_100G, c.food) * diff / 100;
          newCarbs += lookupMacro(CARBS_PER_100G, c.food) * diff / 100;
          newFat += lookupMacro(FAT_PER_100G, c.food) * diff / 100;
        }
        for (const a of additions) {
          newKcal += foodKcal(a.food, a.grams);
          newProt += lookupMacro(PROTEIN_PER_100G, a.food) * a.grams / 100;
          newCarbs += lookupMacro(CARBS_PER_100G, a.food) * a.grams / 100;
          newFat += lookupMacro(FAT_PER_100G, a.food) * a.grams / 100;
        }
        // Tolerance scales with aggressiveness: L1=5%, L2=10%, L3=15%, L4=20%, L5=25%
        const tol = 0.05 + (level - 1) * 0.05;
        // When orig=0, allow only small absolute additions (5g of P/C/F, 50 kcal)
        // — prevents the optimizer from freely loading nuts into a fat-free meal etc.
        const check = (orig: number, delta: number, absFloor = 5) =>
          orig === 0 ? Math.abs(delta) <= absFloor : Math.abs(delta / orig) <= tol;
        if (!check(origMacros.kcal, newKcal, 50) || !check(origMacros.protein, newProt) ||
            !check(origMacros.carbs, newCarbs) || !check(origMacros.fat, newFat)) continue;
      }

      const testFoods = [
        ...reducedFoods,
        ...additions.map(a => ({ name: a.food, amount: `${a.grams} gr` })),
      ];
      const result = calcNNU(testFoods);
      if (!result || result.nnu < original.nnu + 1) continue; // require at least 1% NNU improvement

      results.push({
        changes,
        additions: additions.map(a => ({ ...a, kcal: foodKcal(a.food, a.grams) })),
        foodList: testFoods,
        nnu: result.nnu,
        deltaKcal: totalDeltaKcal,
      });
    }
  }

  if (results.length === 0) return null;

  // Sort: highest NNU, then least calorie change
  results.sort((a, b) => {
    if (a.nnu >= targetNNU && b.nnu < targetNNU) return -1;
    if (b.nnu >= targetNNU && a.nnu < targetNNU) return 1;
    if (Math.abs(a.nnu - b.nnu) < 1) return Math.abs(a.deltaKcal) - Math.abs(b.deltaKcal);
    return b.nnu - a.nnu;
  });

  const best = results[0];
  const foodOnlyNNU = best.nnu;

  // Step 3: close remaining gap with targeted AA supplements
  let supplements: { aa: EAA; mg: number }[] = [];
  let supplementTotalMg = 0;
  let finalNNU = foodOnlyNNU;

  if (foodOnlyNNU < targetNNU) {
    const afterFood = calcNNU(best.foodList);
    if (afterFood) {
      const aaFix = calcTargetedAAs(afterFood.profile, targetNNU);
      if (aaFix) {
        supplements = aaFix.aas;
        supplementTotalMg = aaFix.totalMg;
        finalNNU = aaFix.newNNU;
      }
    }
  }

  // Compute macro deltas using same fuzzy lookup as constraint check
  let deltaProtein = 0, deltaCarbs = 0, deltaFat = 0;
  for (const c of best.changes) {
    const diff = c.newG - c.originalG;
    deltaProtein += lookupMacro(PROTEIN_PER_100G, c.food) * diff / 100;
    deltaCarbs += lookupMacro(CARBS_PER_100G, c.food) * diff / 100;
    deltaFat += lookupMacro(FAT_PER_100G, c.food) * diff / 100;
  }
  for (const a of best.additions) {
    deltaProtein += lookupMacro(PROTEIN_PER_100G, a.food) * a.grams / 100;
    deltaCarbs += lookupMacro(CARBS_PER_100G, a.food) * a.grams / 100;
    deltaFat += lookupMacro(FAT_PER_100G, a.food) * a.grams / 100;
  }
  return {
    changes: best.changes,
    additions: best.additions,
    supplements,
    supplementTotalMg,
    originalNNU: original.nnu,
    foodOnlyNNU,
    finalNNU,
    deltaKcal: best.deltaKcal,
    deltaProtein: Math.round(deltaProtein * 10) / 10,
    deltaCarbs: Math.round(deltaCarbs * 10) / 10,
    deltaFat: Math.round(deltaFat * 10) / 10,
  };
}

/**
 * Compute a single daily EAA supplement recipe by averaging gaps across all meals.
 * Simplifies to the top AAs that matter most (>200mg/day).
 */
export interface DailyEAASupplement {
  perDay: { aa: EAA; mg: number }[];
  perMeal: { aa: EAA; mg: number }[];
  totalPerDay: number;
  mealCount: number;
  avgNNUBefore: number;
  avgNNUAfter: number;
}

export function calcDailyEAA(meals: FoodInput[][], allowedFoods?: string[], level: number = 2): DailyEAASupplement | null {
  const mealResults: { nnu: number; gaps: Record<string, number> }[] = [];

  for (const foods of meals) {
    const nnu = calcNNU(foods);
    if (!nnu || nnu.nnu >= 96) {
      mealResults.push({ nnu: nnu?.nnu || 100, gaps: {} });
      continue;
    }

    // Compute targeted AAs for CURRENT food (not after food optimization)
    const fix = calcTargetedAAs(nnu.profile, 96);
    if (!fix || fix.aas.length === 0) {
      mealResults.push({ nnu: nnu.nnu, gaps: {} });
      continue;
    }

    const gaps: Record<string, number> = {};
    for (const s of fix.aas) gaps[s.aa] = s.mg;
    mealResults.push({ nnu: nnu.nnu, gaps });
  }

  if (mealResults.length === 0) return null;

  // Sum all gaps across meals
  const totalGaps: Record<string, number> = {};
  for (const r of mealResults) {
    for (const [aa, mg] of Object.entries(r.gaps)) {
      totalGaps[aa] = (totalGaps[aa] || 0) + mg;
    }
  }

  // Filter to significant AAs (>200mg/day) and sort by amount
  const perDay = EAA_ORDER
    .filter(aa => (totalGaps[aa] || 0) > 200)
    .map(aa => ({ aa, mg: Math.round((totalGaps[aa] || 0) / 100) * 100 })) // round to 100mg
    .sort((a, b) => b.mg - a.mg);

  if (perDay.length === 0) return null;

  const mealCount = meals.length;
  const perMeal = perDay.map(({ aa, mg }) => ({
    aa,
    mg: Math.round(mg / mealCount / 50) * 50, // round to 50mg
  })).filter(p => p.mg > 0);

  const totalPerDay = perDay.reduce((s, p) => s + p.mg, 0);

  // Weighted average per-meal NNU (weighted by protein content per meal)
  let totalProt = 0, weightedBefore = 0, weightedAfter = 0;
  for (const foods of meals) {
    const nnu = calcNNU(foods);
    if (!nnu || nnu.totalProtein <= 0) continue;
    totalProt += nnu.totalProtein;
    weightedBefore += nnu.nnu * nnu.totalProtein;

    // NNU with per-meal supplement
    const p = { ...nnu.profile };
    for (const s of perMeal) p[s.aa] += s.mg;
    const t = EAA_ORDER.reduce((sum, aa) => sum + p[aa], 0);
    let minR = Infinity;
    for (const aa of EAA_ORDER) { const r = (p[aa] / t * 100) / MAP[aa]; if (r < minR) minR = r; }
    weightedAfter += Math.round(minR * 1000) / 10 * nnu.totalProtein;
  }
  const avgNNUBefore = totalProt > 0 ? Math.round(weightedBefore / totalProt * 10) / 10 : 0;
  const avgNNUAfter = totalProt > 0 ? Math.round(weightedAfter / totalProt * 10) / 10 : 0;

  return { perDay, perMeal, totalPerDay, mealCount, avgNNUBefore, avgNNUAfter };
}

/**
 * A group of meals that share the same EAA mix.
 * `mealIndices` are positions in the input `meals` array.
 */
export interface SupplementGroup {
  mealIndices: number[];
  mealNames: string[];
  supplement: DailyEAASupplement;
}

/**
 * Compute supplement groups. Each main meal can use the same mix (groupCount=1,
 * simplest workflow), share with a few similar meals (groupCount=2, best
 * balance of accuracy vs convenience), or get its own mix (groupCount =
 * meals.length, highest per-meal NNU but most mixing).
 *
 * For groupCount=2 we enumerate every non-trivial partition of the meals into
 * two non-empty subsets and pick the one with the highest protein-weighted
 * NNU after supplementation. For 4 meals that's 7 partitions — trivial.
 */
export function calcGroupedEAA(
  meals: FoodInput[][],
  mealNames: string[],
  groupCount: number,
  allowedFoods?: string[],
  level: number = 2,
): SupplementGroup[] {
  if (meals.length === 0) return [];

  const buildGroup = (idxs: number[]): SupplementGroup | null => {
    const subset = idxs.map(i => meals[i]);
    const sup = calcDailyEAA(subset, allowedFoods, level);
    if (!sup) return null;
    return {
      mealIndices: idxs,
      mealNames: idxs.map(i => mealNames[i] ?? `Meal ${i + 1}`),
      supplement: sup,
    };
  };

  // 1 group: one mix for everything.
  if (groupCount <= 1) {
    const g = buildGroup(meals.map((_, i) => i));
    return g ? [g] : [];
  }

  // Per-meal: one mix per meal.
  if (groupCount >= meals.length) {
    return meals.map((_, i) => buildGroup([i])).filter((g): g is SupplementGroup => g != null);
  }

  // 2 groups: enumerate partitions, pick the highest weighted NNU.
  if (groupCount === 2) {
    const n = meals.length;
    let best: { groups: SupplementGroup[]; nnu: number } | null = null;
    // Fix meal 0 in subset A to dedupe symmetric partitions.
    for (let mask = 0; mask < (1 << (n - 1)); mask++) {
      const a: number[] = [0];
      const b: number[] = [];
      for (let i = 1; i < n; i++) ((mask >> (i - 1)) & 1 ? a : b).push(i);
      if (a.length === 0 || b.length === 0) continue;
      const gA = buildGroup(a);
      const gB = buildGroup(b);
      if (!gA || !gB) continue;
      // Protein-weighted NNU across both groups.
      let totalProt = 0, weighted = 0;
      for (const g of [gA, gB]) {
        // weight by total protein across the group's meals (proxy: supplement counts × meal protein)
        for (const idx of g.mealIndices) {
          const r = calcNNU(meals[idx]);
          if (!r) continue;
          totalProt += r.totalProtein;
          // Per-meal NNU with this group's supplement
          const p = { ...r.profile };
          for (const s of g.supplement.perMeal) p[s.aa] += s.mg;
          const t = EAA_ORDER.reduce((sum, aa) => sum + p[aa], 0);
          let minR = Infinity;
          for (const aa of EAA_ORDER) { const x = (p[aa] / t * 100) / MAP[aa]; if (x < minR) minR = x; }
          weighted += Math.round(minR * 1000) / 10 * r.totalProtein;
        }
      }
      const score = totalProt > 0 ? weighted / totalProt : 0;
      if (!best || score > best.nnu) best = { groups: [gA, gB], nnu: score };
    }
    return best?.groups ?? [];
  }

  // Fallback: not supported, treat as single group.
  const g = buildGroup(meals.map((_, i) => i));
  return g ? [g] : [];
}

// ─── Iterative AI Optimizer ───

export interface IterationResult {
  round: number;
  foodNNU: number;       // weighted avg food-only NNU
  withEAANNU: number;    // weighted avg with supplement
  supplementG: number;   // total daily supplement grams
  mealChanges: { mealIdx: number; changes: MealChange[]; additions: { food: string; grams: number; kcal: number }[] }[];
  supplement: DailyEAASupplement | null;
}

export interface AutoOptimizeResult {
  rounds: IterationResult[];
  finalMeals: FoodInput[][];  // the optimized food per meal
  finalSupplement: DailyEAASupplement | null;
  originalNNU: number;
  finalFoodNNU: number;
  finalWithEAANNU: number;
}

export function autoOptimize(
  meals: FoodInput[][],
  allowedFoods?: string[],
  level: number = 2,
  maxRounds: number = 5,
  onProgress?: (round: number, total: number) => void,
): AutoOptimizeResult {
  let currentMeals = meals.map(m => [...m]); // deep copy
  const rounds: IterationResult[] = [];

  // Original NNU
  const origNNUs = currentMeals.map(m => calcNNU(m));
  let totalP = 0, wNNU = 0;
  for (const n of origNNUs) { if (n) { totalP += n.totalProtein; wNNU += n.nnu * n.totalProtein; } }
  const originalNNU = totalP > 0 ? Math.round(wNNU / totalP * 10) / 10 : 0;

  for (let round = 0; round < maxRounds; round++) {
    onProgress?.(round + 1, maxRounds);
    const prevMeals = currentMeals.map(m => [...m]); // save for revert

    // Step 1: Optimize food per meal
    const allMealChanges: IterationResult['mealChanges'] = [];
    const optimizedMeals: FoodInput[][] = [];

    for (let mi = 0; mi < currentMeals.length; mi++) {
      const foods = currentMeals[mi];
      const opt = optimizeMeal(foods, 96, allowedFoods, level);

      if (opt && opt.foodOnlyNNU > (calcNNU(foods)?.nnu || 0) + 0.5) {
        // Apply food changes
        const newFoods = foods.map(f => {
          const change = opt.changes.find(c => f.name.toLowerCase().includes(c.food) || c.food.includes(f.name.toLowerCase()));
          return change ? { name: f.name, amount: `${change.newG} gr` } : f;
        });
        // Only add foods that aren't already in the meal (prevent duplicates like "salmon" + "Salmon or ground beef cooked")
        for (const a of opt.additions) {
          const isDup = newFoods.some(f => {
            const fn = f.name.toLowerCase();
            return fn.includes(a.food) || a.food.includes(fn) || fn.replace(/s$/, '') === a.food.replace(/s$/, '');
          });
          if (!isDup) newFoods.push({ name: a.food, amount: `${a.grams} gr` });
        }
        optimizedMeals.push(newFoods);
        allMealChanges.push({ mealIdx: mi, changes: opt.changes, additions: opt.additions });
      } else {
        optimizedMeals.push([...foods]);
        allMealChanges.push({ mealIdx: mi, changes: [], additions: [] });
      }
    }

    currentMeals = optimizedMeals;

    // Step 2: Compute daily EAA supplement for optimized food
    const supplement = calcDailyEAA(currentMeals, allowedFoods, level);

    // Compute weighted avg NNU
    let tp = 0, wf = 0, we = 0;
    for (let mi = 0; mi < currentMeals.length; mi++) {
      const nnu = calcNNU(currentMeals[mi]);
      if (!nnu) continue;
      tp += nnu.totalProtein;
      wf += nnu.nnu * nnu.totalProtein;

      if (supplement) {
        const p = { ...nnu.profile };
        for (const s of supplement.perMeal) p[s.aa] += s.mg;
        const t = EAA_ORDER.reduce((sum, aa) => sum + p[aa], 0);
        let minR = Infinity;
        for (const aa of EAA_ORDER) { const r = (p[aa] / t * 100) / MAP[aa]; if (r < minR) minR = r; }
        we += Math.round(minR * 1000) / 10 * nnu.totalProtein;
      } else {
        we += nnu.nnu * nnu.totalProtein;
      }
    }

    const foodNNU = tp > 0 ? Math.round(wf / tp * 10) / 10 : 0;
    const withEAANNU = tp > 0 ? Math.round(we / tp * 10) / 10 : 0;
    const supplementG = supplement ? Math.round(supplement.totalPerDay / 100) / 10 : 0;

    // If this round is worse than previous, revert and stop
    if (round > 0 && withEAANNU < rounds[round - 1].withEAANNU) {
      currentMeals = prevMeals;
      break;
    }

    rounds.push({ round: round + 1, foodNNU, withEAANNU, supplementG, mealChanges: allMealChanges, supplement });

    // Stop if converged (< 0.5% improvement from previous round)
    if (round > 0) {
      const prev = rounds[round - 1];
      if (Math.abs(withEAANNU - prev.withEAANNU) < 0.5 && Math.abs(supplementG - prev.supplementG) < 0.5) break;
    }
  }

  const lastRound = rounds[rounds.length - 1];
  return {
    rounds,
    finalMeals: currentMeals,
    finalSupplement: lastRound?.supplement ?? null,
    originalNNU,
    finalFoodNNU: lastRound?.foodNNU ?? originalNNU,
    finalWithEAANNU: lastRound?.withEAANNU ?? originalNNU,
  };
}

// Keep simple suggestFix as a wrapper for backward compat
/** Calculate individual targeted supplement for a single meal (e.g., After Workout) */
export function calcIndividualSupplement(foods: FoodInput[], targetNNU: number = 96): { aas: { aa: EAA; mg: number }[]; totalMg: number; foodNNU: number; finalNNU: number } | null {
  const nnu = calcNNU(foods);
  if (!nnu || nnu.nnu >= targetNNU) return null;
  const fix = calcTargetedAAs(nnu.profile, targetNNU);
  if (!fix) return null;
  return { aas: fix.aas, totalMg: fix.totalMg, foodNNU: nnu.nnu, finalNNU: fix.newNNU };
}

export function suggestFix(foods: FoodInput[], targetNNU: number = 95): { label: string; addedKcal: number; addedProtein: number; newNNU: number } | null {
  const result = optimizeMeal(foods, targetNNU);
  if (!result) return null;

  const parts: string[] = [];
  for (const c of result.changes) {
    if (c.newG !== c.originalG) parts.push(`${formatFood(c.food, c.originalG)} → ${c.newG}g`);
  }
  for (const a of result.additions) parts.push(`+ ${formatFood(a.food, a.grams)}`);
  if (result.supplements.length > 0) {
    const supParts = result.supplements.map(s =>
      `${s.mg < 1000 ? s.mg + 'mg' : (s.mg / 1000).toFixed(1) + 'g'} ${EAA_NAMES[s.aa]}`
    );
    parts.push(`+ ${supParts.join(', ')}`);
  }

  return {
    label: parts.join('\n'),
    addedKcal: result.deltaKcal,
    addedProtein: 0,
    newNNU: result.finalNNU,
  };
}
