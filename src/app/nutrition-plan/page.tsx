'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import Navigation from '@/components/Navigation';
import { getNutritionPlan, saveNutritionPlan } from '@/utils/storage';
import { NutritionPlan, Meal } from '@/types';

function CircularProgress({ value, max, label, unit, color }: { value: number; max: number; label: string; unit: string; color: string }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min((value / max) * 100, 100);
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="6" />
          <circle
            cx="50" cy="50" r={radius} fill="none"
            stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold text-white">{value}</span>
          <span className="text-[10px] text-white/40 uppercase">{unit}</span>
        </div>
      </div>
      <span className="text-xs text-white/50 mt-2 uppercase tracking-wider">{label}</span>
    </div>
  );
}

const emptyMeal = (): Meal => ({ name: '', time: '', foods: [''], calories: undefined, protein: undefined });

const defaultPlan: NutritionPlan = {
  dailyCalories: 2500,
  protein: 200,
  carbs: 250,
  fat: 80,
  meals: [],
};

export default function NutritionPlanPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [plan, setPlan] = useState<NutritionPlan | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Setup form state
  const [setupForm, setSetupForm] = useState<NutritionPlan>({ ...defaultPlan, meals: [emptyMeal()] });

  // Editing states
  const [editingMacros, setEditingMacros] = useState(false);
  const [macroForm, setMacroForm] = useState({ dailyCalories: 0, protein: 0, carbs: 0, fat: 0 });
  const [editingMealIndex, setEditingMealIndex] = useState<number | null>(null);
  const [mealForm, setMealForm] = useState<Meal>(emptyMeal());
  const [addingMeal, setAddingMeal] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated) {
      getNutritionPlan().then(stored => {
        setPlan(stored);
        setLoaded(true);
      });
    }
  }, [isAuthenticated]);

  const persist = useCallback(async (updated: NutritionPlan) => {
    setPlan(updated);
    await saveNutritionPlan(updated);
  }, []);

  // --- Setup form handlers ---
  const handleSetupSubmit = () => {
    const cleanedMeals = setupForm.meals
      .filter(m => m.name.trim() !== '')
      .map(m => ({ ...m, foods: m.foods.filter(f => f.trim() !== '') }));
    const newPlan: NutritionPlan = { ...setupForm, meals: cleanedMeals };
    persist(newPlan);
  };

  const updateSetupMeal = (idx: number, field: keyof Meal, value: string | number | string[]) => {
    setSetupForm(prev => {
      const meals = [...prev.meals];
      meals[idx] = { ...meals[idx], [field]: value };
      return { ...prev, meals };
    });
  };

  const addSetupMealFood = (mealIdx: number) => {
    setSetupForm(prev => {
      const meals = [...prev.meals];
      meals[mealIdx] = { ...meals[mealIdx], foods: [...meals[mealIdx].foods, ''] };
      return { ...prev, meals };
    });
  };

  const removeSetupMealFood = (mealIdx: number, foodIdx: number) => {
    setSetupForm(prev => {
      const meals = [...prev.meals];
      const foods = meals[mealIdx].foods.filter((_, i) => i !== foodIdx);
      meals[mealIdx] = { ...meals[mealIdx], foods: foods.length ? foods : [''] };
      return { ...prev, meals };
    });
  };

  const updateSetupMealFood = (mealIdx: number, foodIdx: number, value: string) => {
    setSetupForm(prev => {
      const meals = [...prev.meals];
      const foods = [...meals[mealIdx].foods];
      foods[foodIdx] = value;
      meals[mealIdx] = { ...meals[mealIdx], foods };
      return { ...prev, meals };
    });
  };

  // --- Macro editing ---
  const startEditMacros = () => {
    if (!plan) return;
    setMacroForm({ dailyCalories: plan.dailyCalories, protein: plan.protein, carbs: plan.carbs, fat: plan.fat });
    setEditingMacros(true);
  };

  const saveMacros = () => {
    if (!plan) return;
    persist({ ...plan, ...macroForm });
    setEditingMacros(false);
  };

  // --- Meal editing ---
  const startEditMeal = (idx: number) => {
    if (!plan) return;
    const meal = plan.meals[idx];
    setMealForm({ ...meal, foods: [...meal.foods] });
    setEditingMealIndex(idx);
    setAddingMeal(false);
  };

  const startAddMeal = () => {
    setMealForm(emptyMeal());
    setAddingMeal(true);
    setEditingMealIndex(null);
  };

  const saveMeal = () => {
    if (!plan) return;
    const cleaned: Meal = { ...mealForm, foods: mealForm.foods.filter(f => f.trim() !== '') };
    if (!cleaned.name.trim()) return;
    if (cleaned.foods.length === 0) cleaned.foods = [''];

    const meals = [...plan.meals];
    if (addingMeal) {
      meals.push(cleaned);
    } else if (editingMealIndex !== null) {
      meals[editingMealIndex] = cleaned;
    }
    persist({ ...plan, meals });
    setEditingMealIndex(null);
    setAddingMeal(false);
  };

  const removeMeal = (idx: number) => {
    if (!plan) return;
    const meals = plan.meals.filter((_, i) => i !== idx);
    persist({ ...plan, meals });
    if (editingMealIndex === idx) {
      setEditingMealIndex(null);
    }
  };

  const cancelMealEdit = () => {
    setEditingMealIndex(null);
    setAddingMeal(false);
  };

  const addMealFormFood = () => {
    setMealForm(prev => ({ ...prev, foods: [...prev.foods, ''] }));
  };

  const removeMealFormFood = (foodIdx: number) => {
    setMealForm(prev => {
      const foods = prev.foods.filter((_, i) => i !== foodIdx);
      return { ...prev, foods: foods.length ? foods : [''] };
    });
  };

  const updateMealFormFood = (foodIdx: number, value: string) => {
    setMealForm(prev => {
      const foods = [...prev.foods];
      foods[foodIdx] = value;
      return { ...prev, foods };
    });
  };

  // --- Computed ---
  const totalMealCalories = plan?.meals.reduce((sum, m) => sum + (m.calories || 0), 0) ?? 0;
  const totalMealProtein = plan?.meals.reduce((sum, m) => sum + (m.protein || 0), 0) ?? 0;

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-white/40 text-lg">Loading...</div>
      </div>
    );
  }

  // --- Setup form (no plan yet) ---
  if (loaded && !plan) {
    return (
      <div className="min-h-screen">
        <Navigation />
        <main className="md:ml-64 p-6 pt-20 md:pt-6">
          <div className="max-w-5xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-white">Set Up Nutrition Plan</h1>
              <p className="text-white/40 mt-1">Enter your daily macro targets and meals to get started</p>
            </div>

            <div className="glass p-6 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">Daily Macro Targets</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Calories (kcal)</label>
                  <input
                    type="number" className="glass-input w-full" value={setupForm.dailyCalories}
                    onChange={e => setSetupForm(prev => ({ ...prev, dailyCalories: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Protein (g)</label>
                  <input
                    type="number" className="glass-input w-full" value={setupForm.protein}
                    onChange={e => setSetupForm(prev => ({ ...prev, protein: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Carbs (g)</label>
                  <input
                    type="number" className="glass-input w-full" value={setupForm.carbs}
                    onChange={e => setSetupForm(prev => ({ ...prev, carbs: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Fat (g)</label>
                  <input
                    type="number" className="glass-input w-full" value={setupForm.fat}
                    onChange={e => setSetupForm(prev => ({ ...prev, fat: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>

            <div className="glass p-6 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">Meals</h2>
              {setupForm.meals.map((meal, mealIdx) => (
                <div key={mealIdx} className="glass-card p-4 mb-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-white/60">Meal {mealIdx + 1}</span>
                    {setupForm.meals.length > 1 && (
                      <button
                        onClick={() => setSetupForm(prev => ({ ...prev, meals: prev.meals.filter((_, i) => i !== mealIdx) }))}
                        className="text-xs text-red-400 hover:text-red-300"
                      >Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Name</label>
                      <input
                        type="text" className="glass-input w-full" placeholder="e.g. Breakfast"
                        value={meal.name} onChange={e => updateSetupMeal(mealIdx, 'name', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Time</label>
                      <input
                        type="time" className="glass-input w-full"
                        value={meal.time} onChange={e => updateSetupMeal(mealIdx, 'time', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Calories (optional)</label>
                      <input
                        type="number" className="glass-input w-full" placeholder="kcal"
                        value={meal.calories ?? ''} onChange={e => updateSetupMeal(mealIdx, 'calories', e.target.value ? Number(e.target.value) : '')}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/40 block mb-1">Protein (optional)</label>
                      <input
                        type="number" className="glass-input w-full" placeholder="g"
                        value={meal.protein ?? ''} onChange={e => updateSetupMeal(mealIdx, 'protein', e.target.value ? Number(e.target.value) : '')}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Foods</label>
                    {meal.foods.map((food, foodIdx) => (
                      <div key={foodIdx} className="flex gap-2 mb-2">
                        <input
                          type="text" className="glass-input flex-1" placeholder="e.g. 4 eggs scrambled"
                          value={food} onChange={e => updateSetupMealFood(mealIdx, foodIdx, e.target.value)}
                        />
                        {meal.foods.length > 1 && (
                          <button onClick={() => removeSetupMealFood(mealIdx, foodIdx)} className="text-red-400/60 hover:text-red-400 px-2">x</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => addSetupMealFood(mealIdx)} className="text-xs text-white/40 hover:text-white/60 mt-1">+ Add food item</button>
                  </div>
                </div>
              ))}
              <button
                onClick={() => setSetupForm(prev => ({ ...prev, meals: [...prev.meals, emptyMeal()] }))}
                className="btn-secondary text-sm w-full"
              >+ Add Meal</button>
            </div>

            <button onClick={handleSetupSubmit} className="btn-primary w-full text-lg py-3 mb-8">
              Save Nutrition Plan
            </button>
          </div>
        </main>
      </div>
    );
  }

  // --- Main view (plan exists) ---
  return (
    <div className="min-h-screen">
      <Navigation />
      <main className="md:ml-64 p-6 pt-20 md:pt-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-white">Nutrition Plan</h1>
            <p className="text-white/40 mt-1">Manage your daily nutrition and meal plan</p>
          </div>

          {/* Macro Overview */}
          {plan && !editingMacros && (
            <div className="glass p-6 mb-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold text-white">Daily Macro Targets</h2>
                <button onClick={startEditMacros} className="text-xs text-white/40 hover:text-white/60 uppercase tracking-wider">
                  Edit
                </button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 justify-items-center">
                <CircularProgress value={plan.dailyCalories} max={plan.dailyCalories} label="Calories" unit="kcal" color="#b90a0a" />
                <CircularProgress value={totalMealProtein} max={plan.protein} label="Protein" unit="g" color="#3b82f6" />
                <CircularProgress value={plan.carbs} max={plan.carbs} label="Carbs" unit="g" color="#f59e0b" />
                <CircularProgress value={plan.fat} max={plan.fat} label="Fat" unit="g" color="#10b981" />
              </div>
              {totalMealCalories > 0 && (
                <div className="mt-4 pt-4 border-t border-white/5 text-center">
                  <span className="text-xs text-white/40">
                    Meal totals: {totalMealCalories} kcal &middot; {totalMealProtein}g protein
                    {plan.dailyCalories > 0 && ` (${Math.round((totalMealCalories / plan.dailyCalories) * 100)}% of target)`}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Macro Edit Form */}
          {editingMacros && (
            <div className="glass-strong p-6 mb-6">
              <h2 className="text-lg font-semibold text-white mb-4">Edit Macro Targets</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Calories (kcal)</label>
                  <input
                    type="number" className="glass-input w-full" value={macroForm.dailyCalories}
                    onChange={e => setMacroForm(prev => ({ ...prev, dailyCalories: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Protein (g)</label>
                  <input
                    type="number" className="glass-input w-full" value={macroForm.protein}
                    onChange={e => setMacroForm(prev => ({ ...prev, protein: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Carbs (g)</label>
                  <input
                    type="number" className="glass-input w-full" value={macroForm.carbs}
                    onChange={e => setMacroForm(prev => ({ ...prev, carbs: Number(e.target.value) }))}
                  />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Fat (g)</label>
                  <input
                    type="number" className="glass-input w-full" value={macroForm.fat}
                    onChange={e => setMacroForm(prev => ({ ...prev, fat: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={saveMacros} className="btn-primary text-sm">Save</button>
                <button onClick={() => setEditingMacros(false)} className="btn-secondary text-sm">Cancel</button>
              </div>
            </div>
          )}

          {/* Meal Plan */}
          {plan && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-white">Meal Plan</h2>
                <button onClick={startAddMeal} className="btn-secondary text-xs">+ Add Meal</button>
              </div>

              {plan.meals.length === 0 && !addingMeal && (
                <div className="glass-card p-8 text-center">
                  <p className="text-white/40 mb-4">No meals added yet</p>
                  <button onClick={startAddMeal} className="btn-primary text-sm">Add Your First Meal</button>
                </div>
              )}

              <div className="space-y-4">
                {plan.meals.map((meal, idx) => (
                  <div key={idx}>
                    {editingMealIndex === idx ? (
                      /* Inline meal edit form */
                      <div className="glass-strong p-5 rounded-xl">
                        <h3 className="text-sm font-medium text-white/60 mb-3">Edit Meal</h3>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="text-xs text-white/40 block mb-1">Name</label>
                            <input
                              type="text" className="glass-input w-full" value={mealForm.name}
                              onChange={e => setMealForm(prev => ({ ...prev, name: e.target.value }))}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-white/40 block mb-1">Time</label>
                            <input
                              type="time" className="glass-input w-full" value={mealForm.time}
                              onChange={e => setMealForm(prev => ({ ...prev, time: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="text-xs text-white/40 block mb-1">Calories (optional)</label>
                            <input
                              type="number" className="glass-input w-full" placeholder="kcal"
                              value={mealForm.calories ?? ''}
                              onChange={e => setMealForm(prev => ({ ...prev, calories: e.target.value ? Number(e.target.value) : undefined }))}
                            />
                          </div>
                          <div>
                            <label className="text-xs text-white/40 block mb-1">Protein (optional)</label>
                            <input
                              type="number" className="glass-input w-full" placeholder="g"
                              value={mealForm.protein ?? ''}
                              onChange={e => setMealForm(prev => ({ ...prev, protein: e.target.value ? Number(e.target.value) : undefined }))}
                            />
                          </div>
                        </div>
                        <div className="mb-3">
                          <label className="text-xs text-white/40 block mb-1">Foods</label>
                          {mealForm.foods.map((food, foodIdx) => (
                            <div key={foodIdx} className="flex gap-2 mb-2">
                              <input
                                type="text" className="glass-input flex-1" placeholder="e.g. 200g chicken breast"
                                value={food} onChange={e => updateMealFormFood(foodIdx, e.target.value)}
                              />
                              {mealForm.foods.length > 1 && (
                                <button onClick={() => removeMealFormFood(foodIdx)} className="text-red-400/60 hover:text-red-400 px-2">x</button>
                              )}
                            </div>
                          ))}
                          <button onClick={addMealFormFood} className="text-xs text-white/40 hover:text-white/60 mt-1">+ Add food item</button>
                        </div>
                        <div className="flex gap-3">
                          <button onClick={saveMeal} className="btn-primary text-sm">Save</button>
                          <button onClick={cancelMealEdit} className="btn-secondary text-sm">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      /* Meal display card */
                      <div className="glass-card p-5">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h3 className="font-semibold text-white">{meal.name}</h3>
                            {meal.time && (
                              <span className="text-xs text-white/40">{meal.time}</span>
                            )}
                          </div>
                          <div className="flex gap-3">
                            <button onClick={() => startEditMeal(idx)} className="text-xs text-white/40 hover:text-white/60">Edit</button>
                            <button onClick={() => removeMeal(idx)} className="text-xs text-red-400/60 hover:text-red-400">Remove</button>
                          </div>
                        </div>
                        {(meal.calories || meal.protein) && (
                          <div className="flex gap-4 mb-2">
                            {meal.calories && (
                              <span className="text-xs font-medium text-[#b90a0a]">{meal.calories} kcal</span>
                            )}
                            {meal.protein && (
                              <span className="text-xs font-medium text-blue-400">{meal.protein}g protein</span>
                            )}
                          </div>
                        )}
                        <ul className="space-y-1">
                          {meal.foods.map((food, fIdx) => (
                            <li key={fIdx} className="text-sm text-white/60 flex items-start gap-2">
                              <span className="text-white/20 mt-0.5">-</span>
                              <span>{food}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}

                {/* Add meal form */}
                {addingMeal && (
                  <div className="glass-strong p-5 rounded-xl">
                    <h3 className="text-sm font-medium text-white/60 mb-3">New Meal</h3>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Name</label>
                        <input
                          type="text" className="glass-input w-full" placeholder="e.g. Breakfast"
                          value={mealForm.name} onChange={e => setMealForm(prev => ({ ...prev, name: e.target.value }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Time</label>
                        <input
                          type="time" className="glass-input w-full"
                          value={mealForm.time} onChange={e => setMealForm(prev => ({ ...prev, time: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Calories (optional)</label>
                        <input
                          type="number" className="glass-input w-full" placeholder="kcal"
                          value={mealForm.calories ?? ''}
                          onChange={e => setMealForm(prev => ({ ...prev, calories: e.target.value ? Number(e.target.value) : undefined }))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-white/40 block mb-1">Protein (optional)</label>
                        <input
                          type="number" className="glass-input w-full" placeholder="g"
                          value={mealForm.protein ?? ''}
                          onChange={e => setMealForm(prev => ({ ...prev, protein: e.target.value ? Number(e.target.value) : undefined }))}
                        />
                      </div>
                    </div>
                    <div className="mb-3">
                      <label className="text-xs text-white/40 block mb-1">Foods</label>
                      {mealForm.foods.map((food, foodIdx) => (
                        <div key={foodIdx} className="flex gap-2 mb-2">
                          <input
                            type="text" className="glass-input flex-1" placeholder="e.g. 200g chicken breast"
                            value={food} onChange={e => updateMealFormFood(foodIdx, e.target.value)}
                          />
                          {mealForm.foods.length > 1 && (
                            <button onClick={() => removeMealFormFood(foodIdx)} className="text-red-400/60 hover:text-red-400 px-2">x</button>
                          )}
                        </div>
                      ))}
                      <button onClick={addMealFormFood} className="text-xs text-white/40 hover:text-white/60 mt-1">+ Add food item</button>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={saveMeal} className="btn-primary text-sm">Add Meal</button>
                      <button onClick={cancelMealEdit} className="btn-secondary text-sm">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
