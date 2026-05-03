'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navigation from '@/components/Navigation';

// Newest entries first. Add a new object to the top whenever a meaningful
// change ships (formula change, food DB correction, UX change, etc).
const CHANGELOG: Array<{ date: string; title: string; items: string[] }> = [
  {
    date: '2026-05-03',
    title: 'Training: volume comparison glow now robust to un-tapped working sets',
    items: [
      'Sessions logged with weights but without tapping "done" on working sets were getting volume = 0 (warmup-only done flags triggered the done filter). Now the filter only kicks in when at least one *working* set is tap-confirmed, so green/red comparison highlight shows on these sessions',
    ],
  },
  {
    date: '2026-05-01',
    title: 'Bug fixes: oil dosage + REC rotation',
    items: [
      'Oil supplements (Krill / Omega 3 / Fish oil) now scale by their mg dosage. "Omega 3 2000mg" → 2g fat / 18 kcal (was 1g / 9 kcal regardless of dose)',
      'Readiness REC pill rotation order corrected to Mark’s actual sequence: Shoulders+Abs → Back+Biceps → Chest+Triceps → Legs (was Sh→Legs→Chest→Back). Cardio days slot in between but don’t shift the rotation',
      'Sessions are now sorted by timestamp before computing "next group", so the REC time always reflects the correct prior session',
    ],
  },
  {
    date: '2026-04-29',
    title: 'Training: edit exercises during a session',
    items: [
      'Each exercise card has up/down arrows to reorder, plus an X to delete (with confirmation)',
      'New "+ Add Exercise" button at the bottom — typeahead suggests names from your past sessions; new exercises start with 3 working sets at 8-10 reps',
      'Edits auto-save to the current session and propagate to future sessions of the same workout (because startWorkout inherits from the most recent session)',
    ],
  },
  {
    date: '2026-04-26',
    title: 'Training: WhatsApp share + cardio Save button',
    items: [
      'Added "Share" button on every saved session card — opens WhatsApp with a pre-filled summary (date, duration, sets, volume, kcal, top sets) addressed to a friend',
      'First share prompts for an international phone number once; stored locally and reused thereafter',
      'Cardio screen now has a "Save" button alongside Finish (mirrors the lifting screen) — Save persists without exiting the cardio view',
    ],
  },
  {
    date: '2026-04-26',
    title: 'Nutrition Balance: honour manual macro targets',
    items: [
      'Dashboard Nutrition Balance card now uses your manually-set Target row from the Nutrition page (kcal + protein) instead of TDEE × 1.15 and bodyweight × 2.25',
      'Surplus % gauge re-centres on whatever your manual target implies (e.g. 3,250 kcal vs 3,240 TDEE → +0.3% surplus, not +15%)',
      'Subline annotates "(manual)" / "target manual" when the user override is active so you can tell at a glance',
    ],
  },
  {
    date: '2026-04-26',
    title: 'TDEE smoothing: linear regression',
    items: [
      'calcDerivedTDEE now uses a least-squares slope through all weigh-ins in the 28-day window, not endpoint − start',
      'Single noisy weigh-ins (water, glycogen, BIA error) no longer yank the TDEE number around — ~50% less per-measurement variance',
      'Window stays 28 days so the new 3,250 kcal target still surfaces in ~2 weeks',
      'Lean/fat change in the footer now uses the regression-fit endpoints for consistency',
    ],
  },
  {
    date: '2026-04-26',
    title: 'Whole rye bread re-measured',
    items: [
      'Whole rye bread: 200/2/30/0 → 170/5.6/25/1.2 per 100g (Mark\u2019s updated homemade recipe; carbs are net — fiber excluded)',
      'Updated everywhere: nutrition plan food DB, calories util, EAA per-100g lookups (kcal/protein/carbs/fat)',
    ],
  },
  {
    date: '2026-04-25',
    title: 'Manual launched',
    items: [
      'Initial draft of all sections (TDEE, macros, NNU, dashboard, nutrition plan, special meals, sync, phase, references)',
      'Changelog appended at the bottom — updated whenever calc or UX changes',
    ],
  },
  {
    date: '2026-04-24',
    title: 'TDEE method + protein recommendation',
    items: [
      'TDEE switched from personalized BF%-based (lean×1800 + fat×7700) to mixed 5500 kcal/kg — BIA noise was inflating the personalized number',
      'Recommended kcal: ~3,550 → ~3,100 (more conservative, matches your 0.8%/wk gain reality)',
      'Recommended protein stays 2.25 g/kg (258g); added "NNU-adj: ~195g" floor display under it',
      'Protein popup: added NNU 70% → 92% explanation + adjustment math + caveat',
    ],
  },
  {
    date: '2026-04-24',
    title: 'Food DB corrections',
    items: [
      'Whole rye bread: 259/8.5/48/3.3 → 200/2/30/0 per 100g (Mark\u2019s homemade values)',
      'Whey: 400/80/10/5 → 389/69/11/5.6 per 100g (Mark\u2019s label)',
      'Tuna: 132/28/0/1.3 → 116/26/0/0.8 per 100g (USDA: canned in water, drained)',
      'Pumpkin seeds carbs: 5 → 11 per 100g (USDA correction)',
      'Standardized "gr" → "g" across all item amounts and supplements',
      'Dose-dependent supplements (BCAA, EAA, glutamine, maltodextrin, dextrose, cluster dextrin, collagen) now scale macros by grams instead of returning fixed values',
    ],
  },
  {
    date: '2026-04-24',
    title: 'Nutrition plan UX overhaul',
    items: [
      'NNU header made prominent at top: "food only X% → with EAA Y%" — always visible',
      'Recommended row added (science-based, tap any macro for sources + under/overshoot consequences)',
      'After Workout meal: dedicated EAA supplement table replaces the food optimizer',
      'Per-meal NNU pill always shows the optimized arrow (cyan if EAA helps, white if no change)',
      'Intra-workout meal: dedicated targets (230 kcal / 10g P / 40g C / 0g F) instead of an even split of daily total',
      'Cross-device food selection sync fix (was reverting to old version)',
    ],
  },
  {
    date: '2026-04-24',
    title: 'Energy Balance card on dashboard',
    items: [
      'Moved from Training page → Dashboard, renamed Weekly TDEE → Energy Balance',
      'Now uses derived TDEE (intake vs weight trend) — most accurate method',
      'Includes Sunday cheat meal in weekly avg (1,300 kcal − last meal kcal added once/week)',
      'Targets shown under each stat (Intake / Surplus / Pace)',
      'Color thresholds tightened: green ±2pp, amber ±2-5pp, red >5pp from target',
    ],
  },
  {
    date: '2026-04-23',
    title: 'Earlier fixes',
    items: [
      'Apple Watch sync hardened (date format validation, error logging to health-sync-errors)',
      'Cardio durations: manual input only (was inflating to days when session left open)',
      'Gym duration cap at 240 min (sanity ceiling)',
      'Rep tracking: getEffectiveReps helper centralizes the "lower bound of target range" fallback so all 845 historical sets count toward analysis',
      'Bulk Health card moved next to Energy Balance (related cards grouped)',
    ],
  },
];

export default function ManualPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<string>('intro');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login');
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
          <div className="max-w-5xl mx-auto flex items-center justify-center min-h-[60vh]">
            <div className="text-white/40">Loading…</div>
          </div>
        </main>
      </div>
    );
  }

  const TOC: Array<{ id: string; label: string }> = [
    { id: 'intro', label: 'Introduction' },
    { id: 'tdee', label: '1 — How TDEE is calculated' },
    { id: 'macros', label: '2 — Recommended macros' },
    { id: 'nnu', label: '3 — NNU & EAA supplements' },
    { id: 'dashboard', label: '4 — Reading the Dashboard' },
    { id: 'nutrition', label: '5 — Reading the Nutrition Plan' },
    { id: 'meals', label: '6 — Special meal rules' },
    { id: 'sync', label: '7 — Live updates & sync' },
    { id: 'phase', label: '8 — Phase switching (bulk/cut)' },
    { id: 'refs', label: '9 — Sources & references' },
    { id: 'changelog', label: 'Changelog' },
  ];

  const scrollTo = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const Section = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
    <section id={id} className="mb-10 scroll-mt-24">
      <h2 className="text-xl font-bold text-white mb-3 pb-2 border-b border-white/10">{title}</h2>
      <div className="space-y-3 text-[13px] text-white/70 leading-relaxed">{children}</div>
    </section>
  );

  const Box = ({ children, tone = 'info' }: { children: React.ReactNode; tone?: 'info' | 'warn' | 'tip' }) => {
    const tones = {
      info: 'bg-cyan-500/[0.06] border-cyan-500/20 text-cyan-200/80',
      warn: 'bg-yellow-500/[0.06] border-yellow-500/20 text-yellow-200/80',
      tip: 'bg-green-500/[0.06] border-green-500/20 text-green-200/80',
    };
    return <div className={`rounded-lg p-3 border text-[12px] ${tones[tone]}`}>{children}</div>;
  };

  const Code = ({ children }: { children: React.ReactNode }) => (
    <code className="px-1.5 py-0.5 rounded bg-white/[0.06] text-cyan-300/90 font-mono text-[11px]">{children}</code>
  );

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="main-content p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-white">User Manual</h1>
            <p className="text-xs text-white/40 mt-1">How the calorie + nutrition logic works · last updated 2026-04-25</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
            {/* Sticky TOC */}
            <aside className="md:sticky md:top-6 md:self-start">
              <div className="glass-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-white/30 mb-2 px-2">Contents</div>
                <nav className="flex flex-col gap-0.5">
                  {TOC.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => scrollTo(s.id)}
                      className={`text-left text-[12px] px-2 py-1.5 rounded transition-colors ${activeSection === s.id ? 'bg-cyan-500/15 text-cyan-300' : 'text-white/50 hover:text-white/80 hover:bg-white/5'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </nav>
              </div>
            </aside>

            {/* Content */}
            <article className="glass-card p-6">
              <Section id="intro" title="Introduction">
                <p>This manual explains how the calorie and nutrition calculations in this app work, what each card on the dashboard and nutrition page means, and why the numbers are what they are. It&apos;s written for one user (you) so it skips multi-user concerns.</p>
                <p>Everything is computed live from your stored data: measurements (weekly weigh-ins), nutrition plan items, and Apple Watch / Oura activity feeds. There&apos;s no static "set and forget" target — when you edit a meal item, all downstream numbers recompute on the spot.</p>
                <Box tone="info">If something looks wrong, the source-of-truth is always your <strong>weekly weight trend</strong>. If the math says one thing but the scale says another over 2-4 weeks, trust the scale and adjust intake accordingly.</Box>
              </Section>

              <Section id="tdee" title="1 — How TDEE is calculated">
                <p><strong className="text-white">TDEE = Total Daily Energy Expenditure</strong>. The number of kcal you burn per day across BMR + activity + thermic effect of food.</p>
                <p>The Energy Balance card on the dashboard derives TDEE directly from your <em>real intake vs measured weight change</em> over the trailing 28 days. This is the most reliable method — far better than BMR equations × activity multipliers, which are typically off by 300-500 kcal.</p>
                <p className="font-mono text-[12px] text-white/80 bg-white/[0.04] p-3 rounded my-2">
                  weight_change_kg = slope_per_day × window_days  <span className="text-white/40">// from linear regression of all weigh-ins</span><br/>
                  surplus_kcal_per_day = (weight_change_kg × 5500) / days<br/>
                  TDEE = avg_intake_kcal − surplus_kcal_per_day
                </p>
                <p>The weight change isn&apos;t just <em>last weigh-in − first weigh-in</em>. It&apos;s the slope of a least-squares line fit through every weigh-in in the window, multiplied by the window length. This damps single-day noise (water, glycogen, sodium, BIA error) without slowing reactivity to a real intake change — important during active phase tuning.</p>
                <p>The 5500 kcal/kg multiplier represents the average energy cost per kg of mixed lean+fat tissue gain. We tried a personalized version that splits the gain into lean (×1800 kcal/kg) and fat (×7700) using BF% measurements, but BIA-scale noise (±0.5pp swings between weigh-ins) made the result unstable. Mixed is the conservative, coach-standard choice.</p>
                <Box tone="info">
                  <strong>Sunday cheat meal handling:</strong> The weekly average intake includes a one-time +(1,300 − Dinner kcal) bump on Sunday. So your weekly average kcal is higher than your daily plan kcal by ~60-90 kcal/day.
                </Box>
                <p><strong>Why intake-based is better:</strong> classical BMR × PAL (Mifflin-St Jeor × 1.55-1.8) for you would give 3,800-4,500 — but your actual TDEE per the weight-trend math is ~2,700-3,100. The classical estimate is wildly off. Your real TDEE only emerges after several weeks of intake + weight data.</p>
              </Section>

              <Section id="macros" title="2 — Recommended macros">
                <p>The Recommended row on the nutrition plan is computed from TDEE, bodyweight, and phase (bulk/cut).</p>
                <p className="font-mono text-[12px] text-white/80 bg-white/[0.04] p-3 rounded my-2">
                  Kcal target = TDEE × (1 + surplus%)  →  bulk +15%, cut −20%<br/>
                  Protein    = bodyweight × g/kg      →  bulk 2.25, cut 2.4<br/>
                  Fat        = (kcal × 25%) / 9        →  bulk 25%, cut 30%<br/>
                  Carbs      = remainder of kcal
                </p>
                <p>For you (114.8 kg, bulking, TDEE ~2,700): <Code>3,100 kcal / 258g P / 86g F / 352g C</Code>.</p>
                <p>Tap any macro on the Recommended row to see the formula, the source papers, and the consequences of going under or over the recommended amount.</p>
                <Box tone="tip"><strong>NNU-adjusted protein:</strong> Below the Protein cell you&apos;ll see <Code>NNU-adj: ~195g</Code>. That&apos;s a theoretical floor — at your 92% NNU you could eat as little as 195g and still get the same MPS as someone eating 258g at 70% NNU (the assumed quality of typical mixed diets). The main recommendation stays at 258g because protein has uses beyond MPS (immune, connective tissue, satiety, thermic effect) that don&apos;t scale with NNU.</Box>
              </Section>

              <Section id="nnu" title="3 — NNU & EAA supplements">
                <p><strong className="text-white">NNU = Net Nitrogen Utilization</strong>. The percentage of ingested protein that becomes new tissue (vs being oxidized as energy).</p>
                <p>Typical mixed Western diet: ~65–75% NNU. With optimized meals + targeted EAA (Essential Amino Acid) supplementation: 90%+. Yours sits at ~92%.</p>
                <p>NNU is bottlenecked by the <em>limiting amino acid</em> — whichever EAA is below threshold caps MPS for that meal. Different foods are deficient in different EAAs:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Whey: low in lysine</li>
                  <li>Cottage cheese: low in methionine</li>
                  <li>Rice/bread: low in lysine and methionine</li>
                  <li>Eggs: well-balanced (a "complete" protein)</li>
                </ul>
                <p>An EAA supplement adds the deficient amino acids in pre-broken-down powder form, raising the meal&apos;s NNU.</p>
                <p><strong className="text-white">How the daily mix is computed:</strong></p>
                <ol className="list-decimal ml-5 space-y-1">
                  <li>For each main meal, compute the AA gaps to reach 96% NNU</li>
                  <li>Sum gaps across all 4 main meals → "TOTAL PER DAY"</li>
                  <li>Divide by 4 → "PER MEAL" dose (this is what you mix into one powder)</li>
                  <li>Apply the uniform per-meal dose back to each meal and compute the actual achieved NNU (typically ~91-92%, not 96%, because uniform can&apos;t fit every meal perfectly)</li>
                </ol>
                <Box tone="info"><strong>One mix, four equal doses.</strong> The uniform per-meal supplement is mixed once and taken with Breakfast, Lunch 10:30, Lunch 15:00, and Dinner. The During-Workout and After-Workout meals are excluded (they get their own treatment).</Box>
                <p><strong>After-Workout exception:</strong> The post-workout drink (whey + cream of rice + banana) has its own calculated EAA mix because whey&apos;s gaps are very different from solid meals. That mix appears as a separate amber-colored card and is taken individually with the drink.</p>
              </Section>

              <Section id="dashboard" title="4 — Reading the Dashboard">
                <p><strong>Quick stats (top):</strong> latest weight, BF%, MM, chest, waist, legs, arms. Each shows change vs previous measurement, with color-coded direction (green = good, red = bad). For weight, "good" depends on phase (up=good for bulk, down=good for cut).</p>
                <p><strong>Nutrition Balance:</strong> Fuel gauge shows your daily plan&apos;s surplus/deficit % vs your TDEE target. Green dashed box = the +15% (bulk) or −20% (cut) target zone.</p>
                <p><strong>Energy Balance:</strong> The headline TDEE number plus 3 columns (Intake / Surplus / Pace). Each shows your actual + the target underneath. Status: ON-TARGET / SLIGHTLY-OFF / OFF-TARGET based on rate vs phase target (bulk +0.4%/wk, cut −0.6%/wk).</p>
                <p><strong>Bulk Health (only in bulking phase):</strong> 4 KPIs — Rate (%BW/wk), Waist/kg, BF Δ, Arm/kg. Each green/amber/red. Plateau alerts fire if weight stalls 14+ days, waist grows faster than weight, or BF jumps too fast.</p>
                <p><strong>Sleep / Glucose / Readiness:</strong> Pulled from Oura, LibreLinkUp, and a combined readiness score that blends HRV, RHR, sleep, recovery time, subjective check-in. Sunday→Monday gets a +20 cheat-meal correction so a poor night doesn&apos;t flag the readiness as low.</p>
              </Section>

              <Section id="nutrition" title="5 — Reading the Nutrition Plan">
                <p>The page shows training-day plan by default (you can edit rest day separately). Top to bottom:</p>
                <ol className="list-decimal ml-5 space-y-1">
                  <li><strong>NNU header</strong> — gradient card with "food only X% → with EAA Y%" + grams per meal</li>
                  <li><strong>Recommended row</strong> — science-based macros, tap each cell for sources and explanations</li>
                  <li><strong>Target row</strong> — your editable goals (tap the number to edit)</li>
                  <li><strong>Actual row</strong> — live sum of meal items + supplements + EAA daily total</li>
                  <li><strong>Auto-Optimize button</strong> — runs a multi-round food optimizer</li>
                  <li><strong>Daily EAA Supplement panel</strong> — the supplement breakdown</li>
                  <li><strong>Per-meal cards</strong> — each meal&apos;s items, macros, and a tappable NNU pill that opens the AA profile</li>
                </ol>
                <p>The NNU pill on each meal shows <Code>food NNU% → with-EAA NNU%</Code>. Cyan arrow if EAA helps, amber for the After-Workout meal (uses individual EAA), white if no improvement.</p>
              </Section>

              <Section id="meals" title="6 — Special meal rules">
                <p>Three meal types have non-standard treatment:</p>
                <p><strong className="text-white">During Workout (intra)</strong> — supplement-only meal. Targets: <Code>230 kcal / 10g P / 40g C / 0g F</Code>. No food items. Reasons: gut tolerance limits whole protein under load, fat slows gastric emptying, and the leucine pulse + fast carbs are what matters mid-workout. Excluded from NNU (BCAA-only would distort the AA profile).</p>
                <p><strong className="text-white">After Workout (post-WO drink)</strong> — has its own individual EAA supplement (calculated separately from the daily mix). The food optimizer is replaced with the dedicated EAA supplement table. Reason: whey-heavy AA profile needs different gap-filling than solid meals.</p>
                <p><strong className="text-white">Sunday cheat meal</strong> — replaces the last meal of Sunday with a 1,300 kcal cheat. The weekly intake average factors this in: <Code>(daily_kcal × 7 + (1300 − last_meal_kcal)) / 7</Code>. Adds about +60-90 kcal/day to your weekly average.</p>
              </Section>

              <Section id="sync" title="7 — Live updates & sync">
                <p>All numbers in the app are computed <strong>live</strong> from the current data — there&apos;s no manual recalculate step. Edit a meal item → the per-meal NNU pill, the daily EAA supplement breakdown, the Recommended row, and the Actual row all update on the spot.</p>
                <p>Data is stored in <strong>Firestore</strong> (cross-device source of truth) and mirrored to <strong>IndexedDB</strong> (local cache, makes the PWA work offline). When you save:</p>
                <ol className="list-decimal ml-5 space-y-1">
                  <li>Write to IndexedDB immediately (instant local response)</li>
                  <li>Queue a Firestore push (syncs when online)</li>
                  <li>Other devices pull on next mount + background refresh</li>
                </ol>
                <p>If you edit on Device A, then open Device B, B will fetch from Firestore directly on mount and overwrite local cache if remote is newer (last-write-wins by lastModified timestamp).</p>
                <Box tone="warn"><strong>Race condition note:</strong> if you&apos;re editing on two devices at the same time, the last save wins. Don&apos;t do simultaneous edits.</Box>
              </Section>

              <Section id="phase" title="8 — Phase switching (bulk/cut)">
                <p>Toggle phase via the dashboard. Effects:</p>
                <ul className="list-disc ml-5 space-y-1">
                  <li><strong>Energy Balance &amp; Nutrition Balance fuel gauge:</strong> target shifts +15% surplus → −20% deficit (or vice versa). Pace target flips +0.4%/wk gain → −0.6%/wk loss.</li>
                  <li><strong>Recommended macros:</strong> protein 2.25 → 2.4 g/kg, fat 25% → 30% kcal, kcal target shifts (bulk × 1.15 vs cut × 0.8).</li>
                  <li><strong>Stat-card colors:</strong> weight up = green for bulk, red for cut (and vice versa). Same for muscle mass, body fat, waist (BF up is bad in both — flipped at the metric level).</li>
                  <li><strong>Bulk Health card:</strong> only renders in bulking phase. A future "Cut Health" card would mirror it for cutting.</li>
                </ul>
              </Section>

              <Section id="refs" title="9 — Sources & references">
                <p>Inline citations in the Recommended-macro popups link to specific papers. Full list:</p>
                <ul className="list-disc ml-5 space-y-1 text-[12px]">
                  <li>Jäger R. et al. <em>ISSN Position Stand: Protein and exercise.</em> J Int Soc Sports Nutr 14, 20 (2017)</li>
                  <li>Schoenfeld B.J., Aragon A.A. <em>How much protein can the body use in a single meal for muscle-building?</em> J Int Soc Sports Nutr 15, 10 (2018)</li>
                  <li>Morton R.W. et al. <em>A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength.</em> Br J Sports Med 52, 376–384 (2018)</li>
                  <li>Helms E.R., Aragon A.A., Fitschen P.J. <em>Recommendations for natural bodybuilding contest preparation: nutrition and supplementation.</em> J Int Soc Sports Nutr 11, 20 (2014)</li>
                  <li>Volek J.S. et al. <em>Testosterone and cortisol response to dietary fat.</em> J Appl Physiol 82, 49–54 (1997)</li>
                  <li>Burke L.M. et al. <em>Carbohydrates for training and competition.</em> J Sports Sci 29, S17–S27 (2011)</li>
                  <li>Vandenbogaerde T.J., Hopkins W.G. <em>Effects of acute carbohydrate supplementation on endurance performance.</em> Sports Med 41, 773–792 (2011)</li>
                  <li>McDonald L. <em>The Stubborn Fat Solution</em> (2008) and <em>Body Recomposition</em> (Lyle McDonald publications, ongoing)</li>
                  <li>Israetel M. <em>The Renaissance Diet 2.0</em> (RP Strength, 2020)</li>
                  <li>MASS Research Review (monthly meta-analyses by Helms, Nuckols, Zourdos)</li>
                  <li>Galpin A. — lectures on hormonal effects of low-fat diets in trained athletes</li>
                  <li>Wolfe R.R. <em>Branched-chain amino acids and muscle protein synthesis in humans: myth or reality?</em> J Int Soc Sports Nutr 14, 30 (2017)</li>
                  <li>USDA FoodData Central — primary source for FOOD_DB values per 100g edible portion</li>
                </ul>
              </Section>

              <Section id="changelog" title="Changelog">
                <p className="text-white/40 text-[11px] mb-2">Newest first. Each entry summarises a meaningful change to the calc, food DB, or UX.</p>
                <div className="space-y-3">
                  {CHANGELOG.map((entry, i) => (
                    <div key={i} className="rounded-lg p-3 bg-white/[0.03] border border-white/5">
                      <div className="flex items-baseline gap-3 mb-1.5">
                        <span className="text-[11px] font-mono text-cyan-400/70">{entry.date}</span>
                        <span className="text-[13px] font-semibold text-white">{entry.title}</span>
                      </div>
                      <ul className="list-disc ml-5 space-y-0.5 text-[12px] text-white/60">
                        {entry.items.map((item, j) => <li key={j}>{item}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </Section>
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}
