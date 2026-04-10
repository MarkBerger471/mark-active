'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { getNutritionPlan, saveNutritionPlan, getDefaultNutritionPlan } from '@/utils/storage';
import { calcWeeklyIntake } from '@/utils/calories';
import { NutritionPlan, NutritionPlanVersion, DayPlan, NutritionMeal, FoodItem } from '@/types';
import { calcNNU, optimizeMeal, calcDailyEAA, EAA_ORDER, EAA_NAMES, MAP, ALL_OPTIMIZER_FOODS, DEFAULT_OPTIMIZER_FOODS } from '@/utils/eaa';

// Nutrition database: values per 100g
const FOOD_DB: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = {
  'greek yogurt': { kcal: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  'yogurt': { kcal: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  'whey': { kcal: 400, protein: 80, carbs: 10, fat: 5 },
  'whey protein': { kcal: 400, protein: 80, carbs: 10, fat: 5 },
  'oatmeal': { kcal: 389, protein: 17, carbs: 66, fat: 7 },
  'oats': { kcal: 389, protein: 17, carbs: 66, fat: 7 },
  'berries': { kcal: 57, protein: 1.2, carbs: 12, fat: 0.7 },
  'blueberries': { kcal: 57, protein: 0.7, carbs: 14, fat: 0.3 },
  'strawberries': { kcal: 32, protein: 0.7, carbs: 8, fat: 0.3 },
  'banana': { kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  'cheese': { kcal: 403, protein: 25, carbs: 1.3, fat: 33 },
  'cottage cheese': { kcal: 98, protein: 11, carbs: 3.4, fat: 4.3 },
  'feta': { kcal: 264, protein: 14, carbs: 4, fat: 21 },
  'cream cheese': { kcal: 342, protein: 6, carbs: 4, fat: 34 },
  'rice': { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  'white rice': { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  'jasmine rice': { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  'brown rice': { kcal: 112, protein: 2.3, carbs: 24, fat: 0.8 },
  'rice dry': { kcal: 360, protein: 7, carbs: 79, fat: 0.6 },
  'dry rice': { kcal: 360, protein: 7, carbs: 79, fat: 0.6 },
  'cream of rice': { kcal: 370, protein: 6, carbs: 83, fat: 0.5 },
  'rice cakes': { kcal: 387, protein: 8, carbs: 82, fat: 3 },
  'chicken': { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  'chicken breast': { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  'chicken thigh': { kcal: 179, protein: 25, carbs: 0, fat: 8.2 },
  'turkey': { kcal: 147, protein: 30, carbs: 0, fat: 2.1 },
  'turkey breast': { kcal: 147, protein: 30, carbs: 0, fat: 2.1 },
  'beef': { kcal: 254, protein: 26, carbs: 0, fat: 17 },
  'ground beef': { kcal: 254, protein: 26, carbs: 0, fat: 17 },
  'steak': { kcal: 271, protein: 26, carbs: 0, fat: 18 },
  'salmon': { kcal: 208, protein: 20, carbs: 0, fat: 13 },
  'tuna': { kcal: 132, protein: 28, carbs: 0, fat: 1.3 },
  'tilapia': { kcal: 96, protein: 20, carbs: 0, fat: 1.7 },
  'shrimp': { kcal: 99, protein: 24, carbs: 0.2, fat: 0.3 },
  'eggs': { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  'egg': { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
  'egg whites': { kcal: 52, protein: 11, carbs: 0.7, fat: 0.2 },
  'pasta': { kcal: 131, protein: 5, carbs: 25, fat: 1.1 },
  'pasta dry': { kcal: 371, protein: 13, carbs: 74, fat: 1.5 },
  'dry pasta': { kcal: 371, protein: 13, carbs: 74, fat: 1.5 },
  'bread': { kcal: 265, protein: 9, carbs: 49, fat: 3.2 },
  'rye bread': { kcal: 259, protein: 8.5, carbs: 48, fat: 3.3 },
  'whole rye bread': { kcal: 259, protein: 8.5, carbs: 48, fat: 3.3 },
  'sweet potato': { kcal: 86, protein: 1.6, carbs: 20, fat: 0.1 },
  'potato': { kcal: 77, protein: 2, carbs: 17, fat: 0.1 },
  'broccoli': { kcal: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  'veggies': { kcal: 25, protein: 2, carbs: 4, fat: 0.3 },
  'vegetables': { kcal: 25, protein: 2, carbs: 4, fat: 0.3 },
  'spinach': { kcal: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
  'avocado': { kcal: 160, protein: 2, carbs: 9, fat: 15 },
  'olive oil': { kcal: 884, protein: 0, carbs: 0, fat: 100 },
  'coconut oil': { kcal: 862, protein: 0, carbs: 0, fat: 100 },
  'peanut butter': { kcal: 588, protein: 25, carbs: 20, fat: 50 },
  'almond butter': { kcal: 614, protein: 21, carbs: 19, fat: 56 },
  'almonds': { kcal: 579, protein: 21, carbs: 22, fat: 50 },
  'nuts': { kcal: 607, protein: 20, carbs: 21, fat: 54 },
  'walnuts': { kcal: 654, protein: 15, carbs: 14, fat: 65 },
  'milk': { kcal: 42, protein: 3.4, carbs: 5, fat: 1 },
  'whole milk': { kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
  'honey': { kcal: 304, protein: 0.3, carbs: 82, fat: 0 },
  'jam': { kcal: 250, protein: 0.4, carbs: 63, fat: 0.1 },
  'bagel': { kcal: 257, protein: 10, carbs: 50, fat: 1.6 },
  'tortilla': { kcal: 312, protein: 8, carbs: 52, fat: 8 },
  'granola': { kcal: 489, protein: 15, carbs: 64, fat: 20 },
  'protein bar': { kcal: 350, protein: 30, carbs: 35, fat: 10 },
  'casein': { kcal: 370, protein: 75, carbs: 12, fat: 3 },
  'dextrose': { kcal: 400, protein: 0, carbs: 100, fat: 0 },
  'maltodextrin': { kcal: 380, protein: 0, carbs: 95, fat: 0 },
  'cluster dextrin': { kcal: 380, protein: 0, carbs: 95, fat: 0 },
};

// Supplements: fixed macros per serving (not per 100g)
const SUPPLEMENT_DB: Record<string, { kcal: number; protein: number; carbs: number; fat: number }> = {
  'krill oil': { kcal: 5, protein: 0, carbs: 0, fat: 0.5 },
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
  'glutamine': { kcal: 20, protein: 5, carbs: 0, fat: 0 },
  'bcaa': { kcal: 20, protein: 5, carbs: 0, fat: 0 },
  'eaa': { kcal: 20, protein: 5, carbs: 0, fat: 0 },
  'multivitamin': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'ashwagandha': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'melatonin': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'probiotics': { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  'collagen': { kcal: 35, protein: 9, carbs: 0, fat: 0 },
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
};

function lookupFood(name: string): { kcal: number; protein: number; carbs: number; fat: number } | null {
  const key = name.toLowerCase().trim();
  if (FOOD_DB[key]) return FOOD_DB[key];
  // Fuzzy: find the longest (most specific) matching DB key
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
  // Explicit gram unit
  const gMatch = amount.match(/([\d.]+)\s*(?:gr|g|grams?)$/i);
  if (gMatch) return parseFloat(gMatch[1]);
  // Explicit ml (treat as grams for liquids)
  const mlMatch = amount.match(/([\d.]+)\s*ml$/i);
  if (mlMatch) return parseFloat(mlMatch[1]);
  // Bare number — check if this food is countable (pieces)
  const bare = amount.match(/^([\d.]+)$/);
  if (bare) {
    const count = parseFloat(bare[1]);
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

function lookupSupplement(name: string): { kcal: number; protein: number; carbs: number; fat: number } | null {
  const key = name.toLowerCase().trim();
  // Strip dosage from the end: "Krill oil 500mg" -> "krill oil"
  const stripped = key.replace(/\s+\d[\d.,]*\s*(?:mg|gr?|iu|mcg|ml|caps?|tablets?|scoops?)\s*$/i, '').trim();
  if (SUPPLEMENT_DB[stripped]) return SUPPLEMENT_DB[stripped];
  for (const [dbKey, val] of Object.entries(SUPPLEMENT_DB)) {
    if (stripped.includes(dbKey) || dbKey.includes(stripped)) return val;
  }
  return null;
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

function MealCard({ meal, allowedFoods, onSaveOptimized, avgTargets, eaaPerMealMg }: {
  meal: NutritionMeal;
  allowedFoods?: string[];
  onSaveOptimized?: (meal: NutritionMeal) => void;
  avgTargets?: { kcal: number; protein: number; carbs: number; fat: number };
  eaaPerMealMg?: number;
}) {
  const [showNNU, setShowNNU] = useState(false);
  const [level, setLevel] = useState(2);

  const backupKey = `nnu_backup_${meal.name}`;
  const hasBackup = typeof window !== 'undefined' && !!localStorage.getItem(backupKey);

  // Per-meal macros and NNU (lazy — only if items exist)
  const mealMacros = meal.items.length > 0 ? sumMacros([meal]) : { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const parsedFoods = meal.items.map(it => { try { return parseFoodItem(it); } catch { return { name: '' }; } }).filter(it => it.name.trim() && it.amount);
  const foodInputs = parsedFoods.map(f => ({ name: f.name, amount: f.amount }));
  const nnu = parsedFoods.length > 0 ? calcNNU(foodInputs) : null;
  const [optimization, setOptimization] = useState<ReturnType<typeof optimizeMeal>>(null);
  const [optKey, setOptKey] = useState('');

  // Recompute optimization only when NNU panel opens or level changes
  const computeOptimization = () => {
    if (!nnu || nnu.nnu >= 95) return;
    const key = `${level}-${nnu.nnu}`;
    if (key === optKey) return;
    setTimeout(() => {
      setOptimization(optimizeMeal(foodInputs, 96, allowedFoods, level));
      setOptKey(key);
    }, 100);
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
          </button>
        )}
      </div>
      {/* Per-meal macros + delta vs average */}
      <div className="flex gap-3 mb-2 text-[10px]">
        {[
          { label: 'kcal', val: mealMacros.kcal, avg: avgTargets?.kcal },
          { label: 'P', val: mealMacros.protein, avg: avgTargets?.protein },
          { label: 'C', val: mealMacros.carbs, avg: avgTargets?.carbs },
          { label: 'F', val: mealMacros.fat, avg: avgTargets?.fat },
        ].map(m => {
          const delta = m.avg ? m.val - m.avg : 0;
          return (
            <span key={m.label} className="text-white/30">
              {m.val}<span className="text-white/15">{m.label}</span>
              {m.avg && delta !== 0 && (
                <span className={delta > 0 ? ' text-red-400/40' : ' text-green-400/40'}> {delta > 0 ? '+' : ''}{Math.round(delta)}</span>
              )}
            </span>
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
              return (
                <tr key={i} className="text-sm">
                  <td className="py-0.5 text-white/60 pr-4">
                    {item.leading && <span className="text-amber-400 mr-1 text-xs">★</span>}
                    {item.name}
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

          {/* Aggressiveness slider */}
          {nnu && nnu.nnu < 95 && (
            <div className="mt-3 mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-white/25 uppercase tracking-wider">Optimization Level</span>
                <span className="text-[10px] text-white/40">{['Conservative', 'Moderate', 'Aggressive', 'Very Aggressive', 'Extreme'][level - 1]}</span>
              </div>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(l => (
                  <button key={l} onClick={() => { setLevel(l); setOptKey(''); setTimeout(computeOptimization, 50); }}
                    className={`flex-1 h-6 rounded-lg transition-all flex items-center justify-center text-[9px] font-bold ${l <= level ? 'bg-green-400/60 text-white/70' : 'bg-white/10 text-white/20'}`}>{l}</button>
                ))}
              </div>
            </div>
          )}

          {/* Optimization suggestion */}
          {optimization && (
            <div className="mt-2 p-3 rounded-lg bg-green-500/8 border border-green-500/15">
              {/* NNU headline */}
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-lg font-bold text-green-400">NNU {optimization.finalNNU}%</span>
                {optimization.foodOnlyNNU !== optimization.finalNNU && (
                  <span className="text-xs text-white/25">food {optimization.foodOnlyNNU}%</span>
                )}
                <span className="text-xs text-white/15">from {optimization.originalNNU}%</span>
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

              {/* AA supplements */}
              {optimization.supplements.length > 0 && (
                <div className="pt-2 border-t border-white/5">
                  <div className="text-[10px] text-white/25 uppercase mb-1">Remaining gap ({(optimization.supplementTotalMg / 1000).toFixed(1)}g targeted AAs)</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                    {optimization.supplements.map((s, i) => (
                      <div key={i} className="text-xs flex justify-between">
                        <span className="text-cyan-400/60">{EAA_NAMES[s.aa]}</span>
                        <span className="text-cyan-400/40">{s.mg}mg</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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

function DailyEAAPanel({ plan, allowedFoods, onTotalChange }: { plan: NutritionPlan; allowedFoods: string[]; onTotalChange?: (gPerDay: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [daily, setDaily] = useState<ReturnType<typeof calcDailyEAA>>(null);
  const [computing, setComputing] = useState(false);

  const compute = () => {
    if (daily) { setExpanded(!expanded); return; }
    setExpanded(true);
    setComputing(true);
    // Defer to next frame so UI shows "Computing..."
    setTimeout(() => {
      const allMeals = plan.current.trainingDay.meals.map(meal => {
        const items = meal.items.map(it => parseFoodItem(it)).filter(it => it.name.trim() && it.amount);
        return items.map(f => ({ name: f.name, amount: f.amount }));
      }).filter(m => m.length > 0);
      const result = allMeals.length > 0 ? calcDailyEAA(allMeals, allowedFoods, 2) : null;
      setDaily(result);
      setComputing(false);
      if (onTotalChange) onTotalChange(result ? result.totalPerDay / 1000 : 0);
    }, 50);
  };

  return (
    <div className="mb-6">
      <button onClick={compute} className="text-xs text-white/30 hover:text-white/50 uppercase tracking-wider flex items-center gap-2">
        <span className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        Daily EAA Supplement
      </button>
      {expanded && (
        <div className="mt-3 glass-card p-5">
          {computing ? (
            <div className="text-xs text-white/30">Computing optimal supplements...</div>
          ) : daily ? (
            <>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-lg font-bold text-cyan-400">Avg NNU {daily.avgNNUBefore}% → {daily.avgNNUAfter}%</span>
                <span className="text-xs text-white/20">{daily.mealCount} meals · {(daily.totalPerDay / 1000).toFixed(1)}g/day</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Total per day</div>
                  {daily.perDay.map((p, i) => (
                    <div key={i} className="flex justify-between text-xs mb-1">
                      <span className="text-cyan-400/70">{EAA_NAMES[p.aa]}</span>
                      <span className="text-white/40 font-mono">{p.mg < 1000 ? `${p.mg}mg` : `${(p.mg / 1000).toFixed(1)}g`}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-[10px] text-white/25 uppercase tracking-wider mb-2">Per meal (~{daily.mealCount} meals)</div>
                  {daily.perMeal.map((p, i) => (
                    <div key={i} className="flex justify-between text-xs mb-1">
                      <span className="text-cyan-400/70">{EAA_NAMES[p.aa]}</span>
                      <span className="text-white/40 font-mono">{p.mg}mg</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-white/5 text-[10px] text-white/20">
                Mix into a single powder. Take {Math.round(daily.totalPerDay / daily.mealCount / 100) / 10}g per meal.
              </div>
            </>
          ) : (
            <div className="text-xs text-white/30">No supplement needed — all meals above 95% NNU.</div>
          )}
        </div>
      )}
    </div>
  );
}

function MacroTarget({ label, value, onChange, unit, color }: { label: string; value: number; onChange: (v: number) => void; unit: string; color: string }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(String(value));
  return editing ? (
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <input type="number" className="glass-input w-16 text-sm font-bold text-white text-center py-0.5 px-1"
        value={input} onChange={e => setInput(e.target.value)} autoFocus
        onBlur={() => { onChange(parseInt(input) || value); setEditing(false); }}
        onKeyDown={e => { if (e.key === 'Enter') { onChange(parseInt(input) || value); setEditing(false); } }} />
      <span className="text-[10px] text-white/30">{unit}</span>
    </div>
  ) : (
    <button onClick={() => { setInput(String(value)); setEditing(true); }} className="flex items-center gap-1.5 hover:bg-white/5 rounded-lg px-1 py-0.5 transition-all">
      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-xs text-white/40">{label}</span>
      <span className="text-sm font-bold text-white">{value}</span>
      <span className="text-[10px] text-white/30">{unit}</span>
    </button>
  );
}

function DayPlanView({ dayPlan, title, color, editing, onStartEdit, onSave, onCancel, editPlan, setEditPlan, weeklyAvgKcal, allowedFoods, eaaSupplementGPerDay, onSaveOptimizedMeal }: {
  dayPlan: DayPlan;
  title: string;
  color: string;
  weeklyAvgKcal?: number;
  allowedFoods?: string[];
  eaaSupplementGPerDay?: number;
  onSaveOptimizedMeal?: (mealIdx: number, meal: NutritionMeal) => void;
  editing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editPlan: DayPlan | null;
  setEditPlan: (p: DayPlan) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  // Target macros — editable, stored in localStorage
  const [targets, setTargets] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('macro_targets');
      if (stored) return JSON.parse(stored);
    }
    return { kcal: dayPlan.macros.kcal, protein: dayPlan.macros.protein, carbs: dayPlan.macros.carbs, fat: dayPlan.macros.fat };
  });
  const updateTarget = (key: string, value: number) => {
    const next = { ...targets, [key]: value };
    setTargets(next);
    localStorage.setItem('macro_targets', JSON.stringify(next));
  };

  // Actual macros — computed in real-time from all meals + EAA supplement
  const foodMacros = sumMacros(dayPlan.meals);
  const eaaG = eaaSupplementGPerDay || 0;
  const actualMacros = {
    kcal: foodMacros.kcal + Math.round(eaaG * 4),
    protein: foodMacros.protein + Math.round(eaaG),
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
    setEditPlan({ ...editPlan, meals: editPlan.meals.filter((_, i) => i !== mealIdx) });
  };

  const plan = editing && editPlan ? editPlan : dayPlan;
  const computedMacros = sumMacros(plan.meals);

  return (
    <div className="glass-card overflow-hidden p-5">
          {/* Target macros — editable */}
          <div className="mb-1">
            <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Target <span className="text-white/10">(tap to edit)</span></div>
            <div className="grid grid-cols-4 gap-2 p-2 rounded-xl bg-white/5">
              <MacroTarget label="Kcal" value={targets.kcal} onChange={v => updateTarget('kcal', v)} unit="" color="#b90a0a" />
              <MacroTarget label="Protein" value={targets.protein} onChange={v => updateTarget('protein', v)} unit="g" color="#3b82f6" />
              <MacroTarget label="Carbs" value={targets.carbs} onChange={v => updateTarget('carbs', v)} unit="g" color="#f59e0b" />
              <MacroTarget label="Fat" value={targets.fat} onChange={v => updateTarget('fat', v)} unit="g" color="#10b981" />
            </div>
          </div>

          {/* Actual macros — computed from meals */}
          <div className="mb-3">
            <div className="text-[9px] text-white/20 uppercase tracking-wider mb-1">Actual</div>
            <div className="grid grid-cols-4 gap-2 p-2 rounded-xl bg-white/5">
              {[
                { label: 'Kcal', actual: actualMacros.kcal, target: targets.kcal, unit: '', color: '#b90a0a' },
                { label: 'Protein', actual: actualMacros.protein, target: targets.protein, unit: 'g', color: '#3b82f6' },
                { label: 'Carbs', actual: actualMacros.carbs, target: targets.carbs, unit: 'g', color: '#f59e0b' },
                { label: 'Fat', actual: actualMacros.fat, target: targets.fat, unit: 'g', color: '#10b981' },
              ].map(m => {
                const diff = m.actual - m.target;
                const pct = m.target > 0 ? m.actual / m.target : 1;
                const statusColor = pct >= 0.95 && pct <= 1.05 ? 'text-green-400' : pct < 0.95 ? 'text-yellow-400' : 'text-red-400';
                return (
                  <div key={m.label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="text-xs text-white/40">{m.label}</span>
                    <span className={`text-sm font-bold ${statusColor}`}>{m.actual}</span>
                    <span className="text-[10px] text-white/30">{m.unit}</span>
                  </div>
                );
              })}
            </div>
            {weeklyAvgKcal != null && weeklyAvgKcal !== actualMacros.kcal && (
              <p className="text-[11px] text-white/20 mt-1 ml-1">Weekly avg: ~{weeklyAvgKcal} kcal (incl. Sunday cheat)</p>
            )}
          </div>

          {/* Meals */}
          {!editing ? (
            <div>
              {(() => {
                const mealCount = plan.meals.length || 1;
                const avg = { kcal: Math.round(targets.kcal / mealCount), protein: Math.round(targets.protein / mealCount), carbs: Math.round(targets.carbs / mealCount), fat: Math.round(targets.fat / mealCount) };
                const eaaPerMeal = eaaSupplementGPerDay ? Math.round(eaaSupplementGPerDay * 1000 / mealCount) : 0;
                return plan.meals.map((meal, i) => (
                  <MealCard key={i} meal={meal} allowedFoods={allowedFoods}
                    avgTargets={avg} eaaPerMealMg={eaaPerMeal}
                    onSaveOptimized={onSaveOptimizedMeal ? (m) => onSaveOptimizedMeal(i, m) : undefined} />
                ));
              })()}
              <div className="flex justify-end mt-3">
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
                        {meal.items.length > 1 && (
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
  const [eaaGPerDay, setEaaGPerDay] = useState(0);
  const [showFoodPrefs, setShowFoodPrefs] = useState(false);
  const [allowedFoods, setAllowedFoods] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('nnu_allowed_foods');
      if (stored) return JSON.parse(stored);
    }
    return DEFAULT_OPTIMIZER_FOODS;
  });

  const toggleFood = (food: string) => {
    const next = allowedFoods.includes(food) ? allowedFoods.filter(f => f !== food) : [...allowedFoods, food];
    setAllowedFoods(next);
    localStorage.setItem('nnu_allowed_foods', JSON.stringify(next));
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      getNutritionPlan().then(stored => {
        if (stored && 'current' in stored) {
          const p = stored as NutritionPlan;

          setPlan(p);
        } else {
          const defaultVersion = getDefaultNutritionPlan();
          const newPlan: NutritionPlan = { current: defaultVersion, history: [] };
          setPlan(newPlan);
          saveNutritionPlan(newPlan);
        }
        setLoaded(true);
      });
    }
  }, [isAuthenticated]);

  const persist = useCallback(async (updated: NutritionPlan) => {
    setPlan(updated);
    await saveNutritionPlan(updated);
  }, []);

  // Save an optimized meal (from NNU optimizer)
  const saveOptimizedMeal = useCallback(async (mealIdx: number, meal: NutritionMeal) => {
    if (!plan) return;
    // mealIdx includes the prepended empty stomach meal
    const esOffset = plan.current.emptyStomach?.length ? 1 : 0;
    const realIdx = mealIdx - esOffset;
    if (realIdx < 0) return;
    const meals = plan.current.trainingDay.meals.map((m, i) => i === realIdx ? meal : m);
    await persist({ ...plan, current: { ...plan.current, trainingDay: { ...plan.current.trainingDay, meals } } });
  }, [plan, persist]);

  // Build "empty stomach" meal from the shared items
  const emptyStomachItems = plan?.current.emptyStomach;
  const buildEmptyStomachMeal = useCallback((): NutritionMeal | null => {
    if (!emptyStomachItems || emptyStomachItems.length === 0) return null;
    const foods: FoodItem[] = [];
    const sups: string[] = [];
    for (const s of emptyStomachItems) {
      // If it matches the supplement DB, treat as supplement; otherwise as food
      if (lookupSupplement(s)) {
        sups.push(s);
      } else {
        foods.push(parseFoodItem(s));
      }
    }
    return {
      name: 'Empty Stomach',
      subtitle: 'any day',
      items: foods,
      supplements: sups,
    };
  }, [emptyStomachItems]);

  const startEdit = (day: 'training' | 'rest') => {
    if (!plan) return;
    const source = day === 'training' ? plan.current.trainingDay : plan.current.restDay;
    const clone: DayPlan = JSON.parse(JSON.stringify(source));
    // Normalize legacy string items to FoodItem objects
    clone.meals = clone.meals.map(m => ({
      ...m,
      items: m.items.map((item: FoodItem | string) => parseFoodItem(item)),
    }));
    // Prepend empty stomach meal so it's editable
    const esMeal = buildEmptyStomachMeal();
    if (esMeal) {
      clone.meals = [JSON.parse(JSON.stringify(esMeal)), ...clone.meals];
    }
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

    // Separate the empty stomach meal (first meal) back out
    // It's always the first meal if we prepended it in startEdit
    const allMeals = [...editPlan.meals];
    let updatedEmptyStomach: string[] | undefined = plan.current.emptyStomach;
    if (plan.current.emptyStomach && plan.current.emptyStomach.length > 0 && allMeals.length > 0) {
      const esMeal = allMeals.shift()!;
      // Save both food items and supplements back to the flat emptyStomach array
      const fromItems = esMeal.items
        .filter(it => it.name.trim())
        .map(it => {
          const amount = it.amount ? ` ${it.amount}` : '';
          return `${it.name}${amount}`;
        });
      const fromSupplements = (esMeal.supplements || [])
        .filter(s => s.trim());
      updatedEmptyStomach = [...fromItems, ...fromSupplements];
      if (updatedEmptyStomach.length === 0) updatedEmptyStomach = undefined;
    }

    // Stored macros include empty stomach so dashboard matches nutrition page
    const esMealForMacros = buildEmptyStomachMeal();
    const allMealsWithEs = esMealForMacros ? [esMealForMacros, ...allMeals] : allMeals;
    const computed = sumMacros(allMealsWithEs);
    const savedPlan = { ...editPlan, meals: allMeals, macros: computed };

    newVersion.emptyStomach = updatedEmptyStomach;

    if (editingDay === 'training') {
      newVersion.trainingDay = savedPlan;
      // Recompute rest day macros including empty stomach
      const restWithEs = esMealForMacros ? [esMealForMacros, ...newVersion.restDay.meals] : newVersion.restDay.meals;
      newVersion.restDay = { ...newVersion.restDay, macros: sumMacros(restWithEs) };
    } else {
      newVersion.restDay = savedPlan;
      // Recompute training day macros including empty stomach
      const trainWithEs = esMealForMacros ? [esMealForMacros, ...newVersion.trainingDay.meals] : newVersion.trainingDay.meals;
      newVersion.trainingDay = { ...newVersion.trainingDay, macros: sumMacros(trainWithEs) };
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
      </div>
    );
  }

  if (!plan) return null;

  const emptyStomachMeal = buildEmptyStomachMeal();

  const withEmptyStomach = (dayPlan: DayPlan): DayPlan => {
    if (!emptyStomachMeal) return dayPlan;
    return { ...dayPlan, meals: [emptyStomachMeal, ...dayPlan.meals] };
  };

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-4">Nutrition</h1>

          {/* Training Day */}
          <div className="mb-4">
            <DayPlanView
              dayPlan={withEmptyStomach(plan.current.trainingDay)}
              title="Training Day"
              color="#22c55e"
              editing={editingDay === 'training'}
              onStartEdit={() => startEdit('training')}
              onSave={saveEdit}
              onCancel={cancelEdit}
              editPlan={editingDay === 'training' ? editPlan : null}
              setEditPlan={setEditPlan}
              weeklyAvgKcal={calcWeeklyIntake(plan.current.trainingDay.macros.kcal, plan.current.trainingDay.meals).weeklyAvgKcal}
              allowedFoods={allowedFoods}
              eaaSupplementGPerDay={eaaGPerDay}
              onSaveOptimizedMeal={saveOptimizedMeal}
            />
          </div>

          {/* Daily EAA Supplement Summary — computed lazily */}
          <DailyEAAPanel plan={plan} allowedFoods={allowedFoods} onTotalChange={setEaaGPerDay} />

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
                  {plan.history.map((version) => (
                    <div key={version.id} className="glass-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-white/40">
                          {version.startDate} → {version.endDate || 'current'}
                        </span>
                      </div>
                      <div className="text-xs">
                        <span className="text-white/30">{version.trainingDay.macros.kcal} kcal · {version.trainingDay.meals.length} meals</span>
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
