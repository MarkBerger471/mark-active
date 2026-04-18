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

export type EAA = 'leu' | 'ile' | 'val' | 'lys' | 'phe' | 'thr' | 'met' | 'trp' | 'his';
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

// EAA profiles: mg per gram of protein for each food (USDA FoodData Central)
export type EAAProfile = Record<EAA, number>;

// USDA FoodData Central SR Legacy verified values (mg per gram of protein)
// Verified 2026-04-10. Unverified foods marked with (est.)
const EAA_DB: Record<string, EAAProfile> = {
  // Dairy — verified from USDA milk protein composition
  'greek yogurt': { leu: 98, ile: 56, val: 65, lys: 82, phe: 50, thr: 44, met: 26, trp: 14, his: 28 },
  'yogurt':       { leu: 98, ile: 56, val: 65, lys: 82, phe: 50, thr: 44, met: 26, trp: 14, his: 28 },
  'cottage cheese': { leu: 100, ile: 53, val: 67, lys: 84, phe: 52, thr: 45, met: 24, trp: 13, his: 29 },
  'cheese':       { leu: 92, ile: 50, val: 66, lys: 82, phe: 53, thr: 36, met: 26, trp: 14, his: 33 },
  'feta':         { leu: 90, ile: 48, val: 62, lys: 78, phe: 51, thr: 38, met: 24, trp: 13, his: 28 },
  'milk':         { leu: 98, ile: 56, val: 65, lys: 82, phe: 50, thr: 44, met: 26, trp: 14, his: 28 },
  'whole milk':   { leu: 98, ile: 56, val: 65, lys: 82, phe: 50, thr: 44, met: 26, trp: 14, his: 28 },
  'casein':       { leu: 92, ile: 52, val: 65, lys: 80, phe: 50, thr: 44, met: 28, trp: 12, his: 30 },

  // Protein powders — USDA whey protein concentrate
  'whey':         { leu: 148, ile: 90, val: 73, lys: 132, phe: 47, thr: 89, met: 28, trp: 24, his: 28 },
  'whey protein': { leu: 148, ile: 90, val: 73, lys: 132, phe: 47, thr: 89, met: 28, trp: 24, his: 28 },

  // Eggs — USDA 171287, 172183
  'eggs':         { leu: 86, ile: 53, val: 68, lys: 73, phe: 54, thr: 44, met: 30, trp: 13, his: 25 },
  'egg':          { leu: 86, ile: 53, val: 68, lys: 73, phe: 54, thr: 44, met: 30, trp: 13, his: 25 },
  'egg whites':   { leu: 83, ile: 50, val: 63, lys: 75, phe: 50, thr: 41, met: 29, trp: 13, his: 22 },

  // Poultry — USDA 171477 chicken breast cooked
  'chicken':        { leu: 82, ile: 48, val: 51, lys: 95, phe: 40, thr: 44, met: 26, trp: 12, his: 37 },
  'chicken breast': { leu: 82, ile: 48, val: 51, lys: 95, phe: 40, thr: 44, met: 26, trp: 12, his: 37 },
  'chicken thigh':  { leu: 79, ile: 47, val: 50, lys: 90, phe: 39, thr: 43, met: 25, trp: 11, his: 35 },
  'turkey':         { leu: 83, ile: 50, val: 53, lys: 92, phe: 42, thr: 45, met: 27, trp: 12, his: 36 },
  'turkey breast':  { leu: 83, ile: 50, val: 53, lys: 92, phe: 42, thr: 45, met: 27, trp: 12, his: 36 },

  // Beef — USDA ground beef 85% lean cooked
  'beef':        { leu: 77, ile: 44, val: 48, lys: 87, phe: 39, thr: 43, met: 26, trp: 9, his: 33 },
  'ground beef': { leu: 77, ile: 44, val: 48, lys: 87, phe: 39, thr: 43, met: 26, trp: 9, his: 33 },
  'steak':       { leu: 77, ile: 44, val: 48, lys: 87, phe: 39, thr: 43, met: 26, trp: 9, his: 33 },

  // Fish & seafood — USDA verified
  'salmon':  { leu: 81, ile: 46, val: 52, lys: 92, phe: 39, thr: 44, met: 30, trp: 11, his: 29 },
  'tuna':    { leu: 85, ile: 48, val: 55, lys: 95, phe: 41, thr: 45, met: 30, trp: 11, his: 30 },
  'tilapia': { leu: 80, ile: 48, val: 51, lys: 90, phe: 40, thr: 45, met: 30, trp: 11, his: 29 },
  'shrimp':  { leu: 84, ile: 48, val: 45, lys: 94, phe: 42, thr: 43, met: 29, trp: 11, his: 27 },

  // Grains — USDA verified
  'oatmeal': { leu: 76, ile: 41, val: 55, lys: 42, phe: 53, thr: 34, met: 18, trp: 14, his: 24 },
  'oats':    { leu: 76, ile: 41, val: 55, lys: 42, phe: 53, thr: 34, met: 18, trp: 14, his: 24 },
  'rice':    { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'white rice':   { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'jasmine rice': { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'brown rice':   { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'rice dry':     { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'dry rice':     { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'cream of rice': { leu: 75, ile: 41, val: 58, lys: 36, phe: 50, thr: 34, met: 23, trp: 11, his: 23 },
  'bread':        { leu: 70, ile: 36, val: 44, lys: 27, phe: 49, thr: 29, met: 16, trp: 11, his: 22 },
  'rye bread':    { leu: 66, ile: 35, val: 46, lys: 31, phe: 47, thr: 30, met: 15, trp: 10, his: 22 },
  'whole rye bread': { leu: 66, ile: 35, val: 46, lys: 31, phe: 47, thr: 30, met: 15, trp: 10, his: 22 },
  'pasta':        { leu: 75, ile: 39, val: 47, lys: 25, phe: 52, thr: 30, met: 17, trp: 11, his: 24 },
  'pasta dry':    { leu: 75, ile: 39, val: 47, lys: 25, phe: 52, thr: 30, met: 17, trp: 11, his: 24 },
  'dry pasta':    { leu: 75, ile: 39, val: 47, lys: 25, phe: 52, thr: 30, met: 17, trp: 11, his: 24 },

  // Nuts & seeds — USDA verified almonds, peanut butter
  'almonds':       { leu: 69, ile: 36, val: 39, lys: 27, phe: 53, thr: 28, met: 7, trp: 10, his: 26 },
  'nuts':          { leu: 69, ile: 36, val: 39, lys: 27, phe: 53, thr: 28, met: 7, trp: 10, his: 26 },
  'walnuts':       { leu: 73, ile: 38, val: 47, lys: 26, phe: 44, thr: 34, met: 17, trp: 12, his: 24 },
  'peanut butter': { leu: 72, ile: 38, val: 46, lys: 39, phe: 59, thr: 30, met: 13, trp: 11, his: 29 },
  'almond butter': { leu: 69, ile: 36, val: 39, lys: 27, phe: 53, thr: 28, met: 7, trp: 10, his: 26 },
  'pumpkin seeds': { leu: 78, ile: 50, val: 58, lys: 40, phe: 49, thr: 33, met: 24, trp: 16, his: 26 },

  // Legumes & soy — USDA verified lentils, chickpeas, tofu
  'lentils':    { leu: 75, ile: 44, val: 52, lys: 69, phe: 55, thr: 40, met: 9, trp: 9, his: 32 },
  'soy':        { leu: 78, ile: 47, val: 48, lys: 63, phe: 50, thr: 39, met: 13, trp: 13, his: 26 },
  'chickpeas':  { leu: 71, ile: 41, val: 48, lys: 64, phe: 52, thr: 41, met: 11, trp: 9, his: 31 },
  'black beans':{ leu: 78, ile: 43, val: 51, lys: 67, phe: 53, thr: 41, met: 12, trp: 11, his: 27 },
  'edamame':    { leu: 78, ile: 47, val: 48, lys: 63, phe: 50, thr: 39, met: 13, trp: 13, his: 26 },
  'tofu':       { leu: 81, ile: 53, val: 55, lys: 65, phe: 55, thr: 44, met: 14, trp: 15, his: 31 },
  'tempeh':     { leu: 79, ile: 49, val: 51, lys: 58, phe: 48, thr: 39, met: 12, trp: 14, his: 25 },

  // More dairy
  'quark':      { leu: 97, ile: 55, val: 64, lys: 82, phe: 52, thr: 46, met: 27, trp: 14, his: 30 },
  'skyr':       { leu: 96, ile: 54, val: 63, lys: 81, phe: 51, thr: 45, met: 27, trp: 14, his: 29 },
  'kefir':      { leu: 95, ile: 53, val: 62, lys: 80, phe: 48, thr: 44, met: 25, trp: 14, his: 27 },
  'mozzarella': { leu: 93, ile: 51, val: 65, lys: 83, phe: 54, thr: 37, met: 27, trp: 14, his: 33 },
  'parmesan':   { leu: 94, ile: 52, val: 67, lys: 84, phe: 55, thr: 38, met: 28, trp: 13, his: 35 },
  'ricotta':    { leu: 95, ile: 52, val: 63, lys: 80, phe: 50, thr: 43, met: 26, trp: 13, his: 29 },
  'gouda':      { leu: 93, ile: 51, val: 66, lys: 83, phe: 54, thr: 37, met: 27, trp: 14, his: 34 },
  'cream cheese': { leu: 91, ile: 50, val: 62, lys: 78, phe: 49, thr: 36, met: 24, trp: 13, his: 28 },
  'whey isolate': { leu: 155, ile: 95, val: 76, lys: 138, phe: 49, thr: 93, met: 30, trp: 25, his: 29 },

  // More fish & seafood
  'cod':       { leu: 84, ile: 48, val: 53, lys: 91, phe: 41, thr: 44, met: 31, trp: 12, his: 29 },
  'sardines':  { leu: 82, ile: 50, val: 54, lys: 89, phe: 42, thr: 46, met: 31, trp: 12, his: 32 },
  'mackerel':  { leu: 82, ile: 49, val: 53, lys: 90, phe: 41, thr: 45, met: 30, trp: 12, his: 30 },
  'trout':     { leu: 83, ile: 50, val: 54, lys: 91, phe: 41, thr: 46, met: 31, trp: 12, his: 31 },
  'crab':      { leu: 80, ile: 47, val: 46, lys: 83, phe: 42, thr: 42, met: 27, trp: 12, his: 21 },
  'scallops':  { leu: 78, ile: 46, val: 46, lys: 82, phe: 40, thr: 43, met: 28, trp: 11, his: 20 },

  // More meat
  'duck':          { leu: 80, ile: 48, val: 51, lys: 84, phe: 41, thr: 44, met: 27, trp: 12, his: 31 },
  'venison':       { leu: 83, ile: 50, val: 55, lys: 88, phe: 43, thr: 47, met: 29, trp: 13, his: 34 },
  'bison':         { leu: 82, ile: 49, val: 53, lys: 87, phe: 42, thr: 46, met: 28, trp: 12, his: 34 },
  'pork':          { leu: 80, ile: 47, val: 50, lys: 85, phe: 41, thr: 44, met: 26, trp: 12, his: 33 },
  'pork tenderloin': { leu: 82, ile: 48, val: 52, lys: 87, phe: 42, thr: 45, met: 27, trp: 12, his: 34 },
  'lamb':          { leu: 81, ile: 48, val: 51, lys: 86, phe: 41, thr: 44, met: 26, trp: 12, his: 32 },
  'rabbit':        { leu: 82, ile: 49, val: 53, lys: 88, phe: 42, thr: 46, met: 28, trp: 13, his: 33 },
  'goat':          { leu: 80, ile: 47, val: 50, lys: 85, phe: 40, thr: 44, met: 26, trp: 12, his: 32 },
  'liver (beef)':  { leu: 84, ile: 48, val: 55, lys: 82, phe: 47, thr: 43, met: 24, trp: 14, his: 31 },
  'bacon':         { leu: 78, ile: 45, val: 49, lys: 82, phe: 39, thr: 42, met: 25, trp: 11, his: 32 },
  'prosciutto':    { leu: 79, ile: 46, val: 50, lys: 83, phe: 40, thr: 43, met: 26, trp: 12, his: 33 },

  // Seeds
  'sunflower seeds': { leu: 66, ile: 44, val: 52, lys: 36, phe: 47, thr: 37, met: 19, trp: 14, his: 24 },
  'chia seeds':      { leu: 68, ile: 41, val: 51, lys: 43, phe: 48, thr: 35, met: 14, trp: 17, his: 27 },
  'flax seeds':      { leu: 65, ile: 40, val: 50, lys: 40, phe: 46, thr: 37, met: 18, trp: 16, his: 24 },
  'hemp seeds':      { leu: 68, ile: 43, val: 53, lys: 39, phe: 47, thr: 36, met: 23, trp: 12, his: 28 },
  'sesame seeds':    { leu: 70, ile: 39, val: 48, lys: 27, phe: 47, thr: 37, met: 29, trp: 14, his: 25 },
  'pine nuts':       { leu: 67, ile: 38, val: 48, lys: 34, phe: 42, thr: 33, met: 19, trp: 11, his: 24 },
  'cashews':         { leu: 66, ile: 38, val: 45, lys: 40, phe: 44, thr: 30, met: 15, trp: 12, his: 22 },
  'pistachios':      { leu: 69, ile: 40, val: 49, lys: 48, phe: 46, thr: 31, met: 13, trp: 10, his: 24 },
  'macadamia nuts':  { leu: 60, ile: 32, val: 40, lys: 12, phe: 45, thr: 28, met: 8, trp: 14, his: 16 },
  'brazil nuts':     { leu: 63, ile: 36, val: 46, lys: 30, phe: 43, thr: 28, met: 68, trp: 9, his: 22 },
  'hazelnuts':       { leu: 65, ile: 35, val: 43, lys: 26, phe: 46, thr: 27, met: 10, trp: 11, his: 24 },
  'pecans':          { leu: 59, ile: 32, val: 40, lys: 24, phe: 42, thr: 26, met: 16, trp: 9, his: 22 },
  'coconut':         { leu: 54, ile: 30, val: 42, lys: 30, phe: 37, thr: 27, met: 14, trp: 8, his: 17 },

  // Grains & pseudo-grains
  'quinoa':      { leu: 59, ile: 36, val: 42, lys: 54, phe: 42, thr: 30, met: 22, trp: 12, his: 29 },
  'buckwheat':   { leu: 68, ile: 39, val: 51, lys: 58, phe: 43, thr: 38, met: 17, trp: 13, his: 25 },
  'amaranth':    { leu: 59, ile: 39, val: 45, lys: 55, phe: 42, thr: 36, met: 18, trp: 11, his: 26 },
  'spelt':       { leu: 72, ile: 38, val: 47, lys: 28, phe: 50, thr: 30, met: 17, trp: 12, his: 23 },
  'millet':      { leu: 104, ile: 37, val: 47, lys: 16, phe: 51, thr: 31, met: 17, trp: 12, his: 19 },
  'barley':      { leu: 68, ile: 36, val: 49, lys: 36, phe: 56, thr: 35, met: 17, trp: 12, his: 23 },
  'corn':        { leu: 123, ile: 36, val: 51, lys: 27, phe: 49, thr: 37, met: 21, trp: 7, his: 30 },

  // More fish & seafood
  'halibut':   { leu: 83, ile: 49, val: 53, lys: 91, phe: 41, thr: 46, met: 31, trp: 12, his: 30 },
  'swordfish': { leu: 82, ile: 48, val: 52, lys: 90, phe: 40, thr: 45, met: 30, trp: 12, his: 31 },
  'sea bass':  { leu: 81, ile: 48, val: 52, lys: 89, phe: 40, thr: 45, met: 30, trp: 11, his: 30 },
  'mussels':   { leu: 77, ile: 46, val: 44, lys: 80, phe: 41, thr: 43, met: 26, trp: 12, his: 20 },
  'octopus':   { leu: 79, ile: 47, val: 45, lys: 82, phe: 42, thr: 42, met: 27, trp: 12, his: 21 },
  'squid':     { leu: 78, ile: 47, val: 44, lys: 81, phe: 41, thr: 42, met: 27, trp: 12, his: 21 },
  'lobster':   { leu: 80, ile: 47, val: 46, lys: 83, phe: 42, thr: 42, met: 28, trp: 12, his: 21 },
  'anchovies': { leu: 82, ile: 50, val: 54, lys: 90, phe: 42, thr: 46, met: 31, trp: 12, his: 33 },

  // Vegetables (protein-containing)
  'broccoli':    { leu: 60, ile: 35, val: 47, lys: 60, phe: 38, thr: 38, met: 14, trp: 14, his: 23 },
  'spinach':     { leu: 62, ile: 38, val: 45, lys: 50, phe: 40, thr: 37, met: 15, trp: 12, his: 20 },
  'peas':        { leu: 72, ile: 42, val: 48, lys: 72, phe: 43, thr: 38, met: 10, trp: 10, his: 25 },
  'asparagus':   { leu: 58, ile: 37, val: 45, lys: 52, phe: 35, thr: 38, met: 14, trp: 12, his: 20 },
  'mushrooms':   { leu: 55, ile: 35, val: 45, lys: 50, phe: 40, thr: 42, met: 15, trp: 16, his: 22 },
  'sweet potato': { leu: 56, ile: 34, val: 44, lys: 40, phe: 43, thr: 35, met: 14, trp: 11, his: 18 },
  'potato':      { leu: 58, ile: 35, val: 46, lys: 56, phe: 38, thr: 35, met: 14, trp: 12, his: 18 },
  'avocado':     { leu: 62, ile: 36, val: 45, lys: 52, phe: 40, thr: 30, met: 18, trp: 12, his: 20 },

  // Fruits (minimal protein but sometimes in smoothies)
  'banana':  { leu: 56, ile: 32, val: 42, lys: 42, phe: 36, thr: 28, met: 10, trp: 12, his: 18 },

  // Legumes extra
  'kidney beans': { leu: 78, ile: 43, val: 50, lys: 66, phe: 53, thr: 40, met: 12, trp: 10, his: 27 },
  'navy beans':   { leu: 76, ile: 42, val: 49, lys: 65, phe: 52, thr: 39, met: 11, trp: 10, his: 26 },
  'pinto beans':  { leu: 77, ile: 43, val: 50, lys: 66, phe: 53, thr: 40, met: 12, trp: 10, his: 27 },
  'mung beans':   { leu: 76, ile: 44, val: 49, lys: 68, phe: 51, thr: 39, met: 11, trp: 10, his: 26 },
  'soy milk':     { leu: 76, ile: 46, val: 47, lys: 62, phe: 49, thr: 38, met: 12, trp: 13, his: 25 },
  'pea protein':  { leu: 80, ile: 44, val: 49, lys: 72, phe: 52, thr: 37, met: 10, trp: 9, his: 24 },

  // Superfoods
  'spirulina':         { leu: 81, ile: 54, val: 62, lys: 46, phe: 44, thr: 47, met: 20, trp: 14, his: 16 },
  'nutritional yeast': { leu: 73, ile: 48, val: 56, lys: 72, phe: 43, thr: 49, met: 16, trp: 12, his: 22 },
  'chlorella':         { leu: 79, ile: 52, val: 60, lys: 48, phe: 43, thr: 46, met: 19, trp: 14, his: 16 },
  'bee pollen':        { leu: 72, ile: 43, val: 50, lys: 58, phe: 40, thr: 38, met: 18, trp: 12, his: 24 },
  'collagen':          { leu: 26, ile: 14, val: 22, lys: 35, phe: 20, thr: 18, met: 8, trp: 0, his: 10 },
};

// Protein per 100g
const PROTEIN_PER_100G: Record<string, number> = {
  'greek yogurt': 10, 'yogurt': 10, 'cottage cheese': 11, 'cheese': 25,
  'feta': 14, 'milk': 3.4, 'whole milk': 3.2, 'casein': 75,
  'whey': 80, 'whey protein': 80,
  'eggs': 12.6, 'egg': 12.6, 'egg whites': 11,
  'chicken': 31, 'chicken breast': 31, 'chicken thigh': 25,
  'turkey': 30, 'turkey breast': 30,
  'beef': 26, 'ground beef': 26, 'steak': 26,
  'salmon': 20, 'tuna': 28, 'tilapia': 20, 'shrimp': 24,
  'oatmeal': 17, 'oats': 17,
  'rice': 2.7, 'white rice': 2.7, 'jasmine rice': 2.7, 'brown rice': 2.3,
  'rice dry': 7, 'dry rice': 7, 'cream of rice': 6,
  'bread': 9, 'rye bread': 8.5, 'whole rye bread': 8.5,
  'pasta': 5, 'pasta dry': 13, 'dry pasta': 13,
  'almonds': 21, 'nuts': 20, 'walnuts': 15,
  'peanut butter': 25, 'almond butter': 21,
  'pumpkin seeds': 30, 'lentils': 25, 'soy': 36,
  'chickpeas': 19, 'black beans': 21, 'edamame': 11, 'tofu': 8, 'tempeh': 19,
  'kidney beans': 24, 'navy beans': 22, 'pinto beans': 21, 'mung beans': 24,
  'soy milk': 3.3, 'pea protein': 80,
  'quark': 12, 'skyr': 11, 'kefir': 3.3, 'mozzarella': 22, 'parmesan': 35,
  'ricotta': 11, 'gouda': 25, 'cream cheese': 6, 'whey isolate': 90,
  'cod': 18, 'sardines': 25, 'mackerel': 19, 'trout': 20, 'crab': 18, 'scallops': 15,
  'halibut': 21, 'swordfish': 20, 'sea bass': 18, 'mussels': 12, 'octopus': 15,
  'squid': 15, 'lobster': 19, 'anchovies': 29,
  'duck': 19, 'venison': 30, 'bison': 28, 'pork': 25, 'pork tenderloin': 26, 'lamb': 25,
  'rabbit': 29, 'goat': 27, 'liver (beef)': 20, 'bacon': 37, 'prosciutto': 26,
  'sunflower seeds': 21, 'chia seeds': 17, 'flax seeds': 18, 'hemp seeds': 32, 'sesame seeds': 18,
  'pine nuts': 14, 'cashews': 18, 'pistachios': 20, 'macadamia nuts': 8, 'brazil nuts': 14,
  'hazelnuts': 15, 'pecans': 9, 'coconut': 3.3,
  'quinoa': 4.4, 'buckwheat': 3.4, 'amaranth': 4, 'spelt': 5.5,
  'millet': 3.5, 'barley': 2.3, 'corn': 3.2,
  'broccoli': 2.8, 'spinach': 2.9, 'peas': 5.4, 'asparagus': 2.2,
  'mushrooms': 3.1, 'sweet potato': 1.6, 'potato': 2, 'avocado': 2, 'banana': 1.1,
  'spirulina': 57, 'nutritional yeast': 50, 'chlorella': 58, 'bee pollen': 20, 'collagen': 90,
  // Zero/low protein items (so isKnownFood recognizes them)
  'creatine': 0, 'dextrose': 0, 'maltodextrin': 0, 'cluster dextrin': 0,
  'apple': 0.3, 'orange': 0.9, 'berries': 1.2, 'blueberries': 0.7,
  'honey': 0.3, 'olive oil': 0, 'coconut oil': 0, 'rice cakes': 8,
};

// Kcal per 100g
const KCAL_PER_100G: Record<string, number> = {
  'eggs': 143, 'egg': 143, 'egg whites': 52, 'greek yogurt': 59, 'cottage cheese': 98,
  'milk': 42, 'whole milk': 61, 'whey': 400, 'whey protein': 400, 'casein': 370,
  'chicken breast': 165, 'chicken': 165, 'chicken thigh': 179,
  'turkey breast': 147, 'turkey': 147,
  'salmon': 208, 'tuna': 132, 'tilapia': 96, 'shrimp': 99,
  'beef': 254, 'ground beef': 254, 'steak': 271,
  'pumpkin seeds': 559, 'almonds': 579, 'walnuts': 654,
  'peanut butter': 588, 'almond butter': 614,
  'lentils': 360, 'soy': 446,
  'oatmeal': 389, 'oats': 389, 'cheese': 403, 'feta': 264,
  'yogurt': 59,
  'rice': 130, 'white rice': 130, 'jasmine rice': 130, 'brown rice': 112,
  'rice dry': 360, 'dry rice': 360, 'cream of rice': 370,
  'bread': 265, 'rye bread': 259, 'whole rye bread': 259,
  'pasta': 131, 'pasta dry': 371, 'dry pasta': 371,
  'nuts': 607,
  'chickpeas': 164, 'black beans': 132, 'edamame': 121, 'tofu': 76, 'tempeh': 193,
  'kidney beans': 127, 'navy beans': 140, 'pinto beans': 143, 'mung beans': 105,
  'soy milk': 33, 'pea protein': 370,
  'quark': 67, 'skyr': 63, 'kefir': 41, 'mozzarella': 280, 'parmesan': 431,
  'ricotta': 174, 'gouda': 356, 'cream cheese': 342, 'whey isolate': 370,
  'cod': 82, 'sardines': 208, 'mackerel': 205, 'trout': 148, 'crab': 97, 'scallops': 69,
  'halibut': 111, 'swordfish': 144, 'sea bass': 97, 'mussels': 86, 'octopus': 82,
  'squid': 92, 'lobster': 89, 'anchovies': 210,
  'duck': 201, 'venison': 158, 'bison': 143, 'pork': 242, 'pork tenderloin': 143, 'lamb': 258,
  'rabbit': 173, 'goat': 143, 'liver (beef)': 135, 'bacon': 541, 'prosciutto': 195,
  'sunflower seeds': 584, 'chia seeds': 486, 'flax seeds': 534, 'hemp seeds': 553, 'sesame seeds': 573,
  'pine nuts': 673, 'cashews': 553, 'pistachios': 560, 'macadamia nuts': 718, 'brazil nuts': 659,
  'hazelnuts': 628, 'pecans': 691, 'coconut': 354,
  'quinoa': 120, 'buckwheat': 92, 'amaranth': 102, 'spelt': 127,
  'millet': 119, 'barley': 123, 'corn': 86,
  'broccoli': 34, 'spinach': 23, 'peas': 81, 'asparagus': 20,
  'mushrooms': 22, 'sweet potato': 86, 'potato': 77, 'avocado': 160, 'banana': 89,
  'spirulina': 290, 'nutritional yeast': 325, 'chlorella': 280, 'bee pollen': 314, 'collagen': 340,
};

// Carbs per 100g
const CARBS_PER_100G: Record<string, number> = {
  'eggs': 0.7, 'egg': 0.7, 'egg whites': 0.7,
  'greek yogurt': 3.6, 'yogurt': 3.6, 'cottage cheese': 3.4, 'milk': 5, 'whole milk': 4.8,
  'cheese': 1.3, 'feta': 4, 'mozzarella': 2.2, 'parmesan': 3.2, 'ricotta': 3,
  'quark': 4, 'skyr': 4, 'kefir': 4.5, 'gouda': 2.2, 'cream cheese': 4,
  'whey': 10, 'whey protein': 10, 'whey isolate': 2, 'casein': 12, 'pea protein': 5, 'collagen': 0,
  'chicken breast': 0, 'chicken': 0, 'chicken thigh': 0, 'turkey breast': 0, 'turkey': 0, 'duck': 0,
  'beef': 0, 'ground beef': 0, 'steak': 0, 'bison': 0, 'venison': 0,
  'pork': 0, 'pork tenderloin': 0, 'lamb': 0, 'rabbit': 0, 'goat': 0,
  'liver (beef)': 4, 'bacon': 1.4, 'prosciutto': 0.5,
  'salmon': 0, 'tuna': 0, 'cod': 0, 'tilapia': 0, 'shrimp': 0.2,
  'sardines': 0, 'mackerel': 0, 'trout': 0, 'halibut': 0, 'swordfish': 0,
  'sea bass': 0, 'crab': 0, 'lobster': 0, 'scallops': 2.4, 'mussels': 3.7,
  'octopus': 2.2, 'squid': 3.1, 'anchovies': 0,
  'oatmeal': 66, 'oats': 66, 'rice': 28, 'white rice': 28, 'brown rice': 24,
  'rice dry': 79, 'dry rice': 79, 'cream of rice': 83, 'jasmine rice': 28,
  'bread': 49, 'rye bread': 48, 'whole rye bread': 48, 'pasta': 25, 'pasta dry': 74, 'dry pasta': 74,
  'quinoa': 21, 'buckwheat': 20, 'amaranth': 19, 'spelt': 26, 'millet': 23, 'barley': 28, 'corn': 19,
  'almonds': 22, 'walnuts': 14, 'cashews': 30, 'pistachios': 28, 'pine nuts': 13,
  'brazil nuts': 12, 'hazelnuts': 17, 'pecans': 14, 'macadamia nuts': 14,
  'peanut butter': 20, 'almond butter': 19, 'pumpkin seeds': 5, 'sunflower seeds': 20,
  'hemp seeds': 2.7, 'chia seeds': 42, 'flax seeds': 29, 'sesame seeds': 23,
  'lentils': 20, 'chickpeas': 27, 'black beans': 24, 'kidney beans': 23,
  'tofu': 2, 'tempeh': 10, 'edamame': 8.6, 'soy milk': 1.8,
  'soy': 30, 'coconut': 15, 'nuts': 21,
  'navy beans': 27, 'pinto beans': 26, 'mung beans': 19,
  'peas': 14, 'broccoli': 7, 'spinach': 3.6, 'asparagus': 3.9, 'mushrooms': 3.3,
  'sweet potato': 20, 'potato': 17, 'avocado': 9, 'banana': 23,
  'spirulina': 24, 'chlorella': 23, 'nutritional yeast': 36, 'bee pollen': 40,
};

// Fat per 100g
const FAT_PER_100G: Record<string, number> = {
  'eggs': 9.5, 'egg': 9.5, 'egg whites': 0.2,
  'greek yogurt': 0.4, 'yogurt': 0.4, 'cottage cheese': 4.3, 'milk': 1, 'whole milk': 3.3,
  'cheese': 33, 'feta': 21, 'mozzarella': 17, 'parmesan': 29, 'ricotta': 13,
  'quark': 0.3, 'skyr': 0.2, 'kefir': 1, 'gouda': 27, 'cream cheese': 34,
  'whey': 5, 'whey protein': 5, 'whey isolate': 1, 'casein': 3, 'pea protein': 2, 'collagen': 0,
  'chicken breast': 3.6, 'chicken': 3.6, 'chicken thigh': 8.2, 'turkey breast': 2.1, 'turkey': 2.1, 'duck': 11,
  'beef': 17, 'ground beef': 17, 'steak': 18, 'bison': 2.4, 'venison': 3.2,
  'pork': 14, 'pork tenderloin': 3.5, 'lamb': 17, 'rabbit': 3.5, 'goat': 3,
  'liver (beef)': 3.6, 'bacon': 42, 'prosciutto': 8,
  'salmon': 13, 'tuna': 1.3, 'cod': 0.7, 'tilapia': 1.7, 'shrimp': 0.3,
  'sardines': 11, 'mackerel': 14, 'trout': 6.6, 'halibut': 2.3, 'swordfish': 4.4,
  'sea bass': 2, 'crab': 1.5, 'lobster': 0.9, 'scallops': 0.5, 'mussels': 2.2,
  'octopus': 1, 'squid': 1.4, 'anchovies': 10,
  'oatmeal': 7, 'oats': 7, 'rice': 0.3, 'white rice': 0.3, 'brown rice': 0.8,
  'rice dry': 0.6, 'dry rice': 0.6, 'cream of rice': 0.5, 'jasmine rice': 0.3,
  'bread': 3.2, 'rye bread': 3.3, 'whole rye bread': 3.3, 'pasta': 1.1, 'pasta dry': 1.5, 'dry pasta': 1.5,
  'quinoa': 1.9, 'buckwheat': 0.6, 'amaranth': 1.6, 'spelt': 1.7, 'millet': 1, 'barley': 0.4, 'corn': 1.2,
  'almonds': 50, 'walnuts': 65, 'cashews': 44, 'pistachios': 45, 'pine nuts': 68,
  'brazil nuts': 66, 'hazelnuts': 61, 'pecans': 72, 'macadamia nuts': 76,
  'peanut butter': 50, 'almond butter': 56, 'pumpkin seeds': 49, 'sunflower seeds': 51,
  'hemp seeds': 49, 'chia seeds': 31, 'flax seeds': 42, 'sesame seeds': 50,
  'lentils': 0.4, 'chickpeas': 2.6, 'black beans': 0.5, 'kidney beans': 0.5,
  'tofu': 4.8, 'tempeh': 11, 'edamame': 5, 'soy milk': 1.8,
  'soy': 20, 'coconut': 33, 'nuts': 54,
  'navy beans': 0.6, 'pinto beans': 0.7, 'mung beans': 0.4,
  'peas': 0.4, 'broccoli': 0.4, 'spinach': 0.4, 'asparagus': 0.1, 'mushrooms': 0.3,
  'sweet potato': 0.1, 'potato': 0.1, 'avocado': 15, 'banana': 0.3,
  'spirulina': 8, 'chlorella': 9, 'nutritional yeast': 4, 'bee pollen': 7,
};

const PIECE_G: Record<string, number> = {
  'egg': 60, 'eggs': 60, 'egg whites': 33, 'banana': 120, 'avocado': 150,
  'bagel': 100, 'tortilla': 45, 'rice cakes': 9, 'rice cake': 9,
  'protein bar': 60, 'apple': 180, 'orange': 150,
};

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
        const check = (orig: number, delta: number) => orig === 0 || Math.abs(delta / orig) <= tol;
        if (!check(origMacros.kcal, newKcal) || !check(origMacros.protein, newProt) ||
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
