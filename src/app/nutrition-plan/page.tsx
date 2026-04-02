'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { getNutritionPlan, saveNutritionPlan, getDefaultNutritionPlan } from '@/utils/storage';
import { NutritionPlan, NutritionPlanVersion, DayPlan, NutritionMeal, FoodItem } from '@/types';

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

function parseFoodItem(item: FoodItem | string): { name: string; amount?: string } {
  if (typeof item === 'string') {
    // Legacy format: "Greek yogurt 250" or "Greek yogurt 250 gr"
    const matchWithUnit = item.match(/^(.+?)\s+(\d[\d.]*\s*(?:gr|g|mg|ml|iu|scoop).*)$/i);
    if (matchWithUnit) return { name: matchWithUnit[1], amount: matchWithUnit[2] };
    // Bare number at end — assume grams
    const matchBare = item.match(/^(.+?)\s+(\d[\d.]*)$/);
    if (matchBare) return { name: matchBare[1], amount: `${matchBare[2]} gr` };
    return { name: item };
  }
  // Already a FoodItem — add "gr" to bare numbers
  if (item.amount && /^\d[\d.]*$/.test(item.amount.trim())) {
    return { ...item, amount: `${item.amount.trim()} gr` };
  }
  return item;
}

function MealCard({ meal }: { meal: NutritionMeal }) {
  return (
    <div className="py-3 border-b border-white/5 last:border-0">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-sm font-semibold text-white">{meal.name}</span>
          {meal.subtitle && <span className="text-xs text-white/30 ml-2">({meal.subtitle})</span>}
        </div>
      </div>
      {meal.items.length > 0 && (
        <table className="w-full">
          <tbody>
            {meal.items.map((rawItem, i) => {
              const item = parseFoodItem(rawItem);
              return (
                <tr key={i} className="text-sm">
                  <td className="py-0.5 text-white/60 pr-4">{item.name}</td>
                  <td className="py-0.5 text-white/40 text-right whitespace-nowrap font-mono text-xs">{item.amount || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {meal.supplements && meal.supplements.length > 0 && (
        <div className="mt-2 pt-2 border-t border-white/5">
          {meal.supplements.map((s, i) => (
            <span key={i} className="text-[11px] text-amber-400/50 block">+ {s}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function DayPlanView({ dayPlan, title, color, editing, onStartEdit, onSave, onCancel, editPlan, setEditPlan }: {
  dayPlan: DayPlan;
  title: string;
  color: string;
  editing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  editPlan: DayPlan | null;
  setEditPlan: (p: DayPlan) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const updateMealItemName = (mealIdx: number, itemIdx: number, name: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, items: m.items.map((it, ii) => ii === itemIdx ? { ...it, name } : it) } : m);
    setEditPlan({ ...editPlan, meals });
  };

  const updateMealItemAmount = (mealIdx: number, itemIdx: number, amount: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, items: m.items.map((it, ii) => ii === itemIdx ? { ...it, amount: amount || undefined } : it) } : m);
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

  const updateSupplement = (mealIdx: number, supIdx: number, value: string) => {
    if (!editPlan) return;
    const meals = editPlan.meals.map((m, mi) => mi === mealIdx ? { ...m, supplements: (m.supplements || []).map((s, si) => si === supIdx ? value : s) } : m);
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

  const updateMacro = (field: string, value: number) => {
    if (!editPlan) return;
    setEditPlan({ ...editPlan, macros: { ...editPlan.macros, [field]: value } });
  };

  const plan = editing && editPlan ? editPlan : dayPlan;

  return (
    <div className="glass-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-5 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="text-lg font-bold text-white">{title}</h2>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-white/30">{plan.macros.kcal} kcal</span>
          <span className={`text-white/20 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        </div>
      </button>

      {expanded && (
        <div className="px-5 pb-5">
          {/* Macros */}
          {!editing ? (
            <div className="grid grid-cols-4 gap-2 mb-4 p-3 rounded-xl bg-white/5">
              <MacroBar label="Kcal" value={plan.macros.kcal} unit="" color="#b90a0a" />
              <MacroBar label="Protein" value={plan.macros.protein} unit="g" color="#3b82f6" />
              <MacroBar label="Carbs" value={plan.macros.carbs} unit="g" color="#f59e0b" />
              <MacroBar label="Fat" value={plan.macros.fat} unit="g" color="#10b981" />
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 p-3 rounded-xl bg-white/5">
              {[
                { key: 'kcal', label: 'Calories (kcal)' },
                { key: 'protein', label: 'Protein (g)' },
                { key: 'carbs', label: 'Carbs (g)' },
                { key: 'fat', label: 'Fat (g)' },
              ].map(m => (
                <div key={m.key}>
                  <label className="text-[10px] text-white/30 uppercase block mb-1">{m.label}</label>
                  <input
                    type="number" className="glass-input w-full text-sm"
                    value={plan.macros[m.key as keyof typeof plan.macros]}
                    onChange={e => updateMacro(m.key, Number(e.target.value))}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Meals */}
          {!editing ? (
            <div>
              {plan.meals.map((meal, i) => (
                <MealCard key={i} meal={meal} />
              ))}
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
                  {meal.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex gap-1.5 mb-1.5">
                      <input
                        type="text" className="glass-input flex-[2] text-sm"
                        value={item.name} onChange={e => updateMealItemName(mealIdx, itemIdx, e.target.value)}
                        placeholder="Food name"
                      />
                      <input
                        type="text" className="glass-input flex-1 text-sm text-right"
                        value={item.amount || ''} onChange={e => updateMealItemAmount(mealIdx, itemIdx, e.target.value)}
                        placeholder="Amount"
                      />
                      {meal.items.length > 1 && (
                        <button onClick={() => removeMealItem(mealIdx, itemIdx)} className="text-red-400/40 hover:text-red-400 px-1.5 text-xs">x</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => addMealItem(mealIdx)} className="text-[11px] text-white/30 hover:text-white/50 mt-1">+ Add food</button>

                  {/* Supplements */}
                  {(meal.supplements && meal.supplements.length > 0 || true) && (
                    <div className="mt-2">
                      <label className="text-[10px] text-white/25 uppercase block mb-1">Supplements</label>
                      {(meal.supplements || []).map((sup, supIdx) => (
                        <div key={supIdx} className="flex gap-1.5 mb-1.5">
                          <input
                            type="text" className="glass-input flex-1 text-sm"
                            value={sup} onChange={e => updateSupplement(mealIdx, supIdx, e.target.value)}
                            placeholder="Supplement"
                          />
                          <button onClick={() => removeSupplement(mealIdx, supIdx)} className="text-red-400/40 hover:text-red-400 px-1.5 text-xs">x</button>
                        </div>
                      ))}
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

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      getNutritionPlan().then(stored => {
        if (stored && 'current' in stored) {
          setPlan(stored as NutritionPlan);
        } else {
          // No plan or legacy plan — initialize with defaults
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

  const startEdit = (day: 'training' | 'rest') => {
    if (!plan) return;
    const source = day === 'training' ? plan.current.trainingDay : plan.current.restDay;
    const clone: DayPlan = JSON.parse(JSON.stringify(source));
    // Normalize legacy string items to FoodItem objects
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

  const saveEdit = () => {
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

    if (editingDay === 'training') {
      newVersion.trainingDay = editPlan;
    } else {
      newVersion.restDay = editPlan;
    }

    persist({
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

  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:ml-64 p-6 pt-32 md:pt-6 pwa-main">
        <div className="max-w-5xl mx-auto">
          <h1 className="text-3xl font-bold text-white mb-4">Nutrition</h1>

          {/* Empty stomach section */}
          {plan.current.emptyStomach && plan.current.emptyStomach.length > 0 && (
            <div className="glass-card p-5 mb-4">
              <h3 className="text-sm font-semibold text-white mb-3">Any day, empty stomach</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                {plan.current.emptyStomach.map((item, i) => (
                  <span key={i} className="text-sm text-white/50">· {item}</span>
                ))}
              </div>
            </div>
          )}

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
            />
          </div>

          {/* Rest Day */}
          <div className="mb-6">
            <DayPlanView
              dayPlan={plan.current.restDay}
              title="Rest Day"
              color="#ef4444"
              editing={editingDay === 'rest'}
              onStartEdit={() => startEdit('rest')}
              onSave={saveEdit}
              onCancel={cancelEdit}
              editPlan={editingDay === 'rest' ? editPlan : null}
              setEditPlan={setEditPlan}
            />
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
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div>
                          <span className="text-white/50 font-medium">Training Day</span>
                          <span className="text-white/30 ml-2">{version.trainingDay.macros.kcal} kcal · {version.trainingDay.meals.length} meals</span>
                        </div>
                        <div>
                          <span className="text-white/50 font-medium">Rest Day</span>
                          <span className="text-white/30 ml-2">{version.restDay.macros.kcal} kcal · {version.restDay.meals.length} meals</span>
                        </div>
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
