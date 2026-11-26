import type { SupabaseClient } from '@supabase/supabase-js';
import { withDeadline } from './request-deadline';
import { isDefinitiveWriteRejection } from './write-outcome';

export type TrialValues = { name: string; ingredients: string; method: string; changes: string };
export type RecipeTrialRequest = { actor: string; recipeId: string; trialId: string; values: TrialValues };
export type RecipeTrial = { id: string; recipe_id: string; number: number; ingredients: string; method: string; changes: string; created_at: string };
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Client = Pick<SupabaseClient, 'rpc' | 'auth'>;
export const recipeTrialKey = (actor: string) => `pos_recipe_trial:v1:${actor}`;
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export function readRecipeTrial(storage: Storage, actor: string): RecipeTrialRequest | null {
  const raw = storage.getItem(recipeTrialKey(actor));
  if (!raw) return null;
  if (raw.length > 30_000) throw new Error('La prueba pendiente requiere revisión.');
  const p = JSON.parse(raw) as RecipeTrialRequest;
  if (!p || p.actor !== actor || !uuid.test(p.recipeId) || !uuid.test(p.trialId) || !p.values
    || !['name', 'ingredients', 'method', 'changes'].every(key => typeof p.values[key as keyof TrialValues] === 'string')
    || !p.values.name.trim() || p.values.name.length > 100 || !p.values.ingredients.trim()
    || [p.values.ingredients, p.values.method, p.values.changes].some(value => value.length > 4000)) {
    throw new Error('La prueba pendiente requiere revisión.');
  }
  return p;
}

// New writes and explicit recovery share a lock, but a new save never replays
// an earlier window's payload. Persist the exact identity before any RPC.
export async function writeRecipeTrial(client: Client, storage: Storage, actor: string,
  input?: { recipeId?: string; values: TrialValues }, timeoutMs = 10_000) {
  if (!navigator.locks) throw new Error('Usa un navegador actualizado y una conexión segura para guardar pruebas.');
  return navigator.locks.request(recipeTrialKey(actor), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Otra ventana está guardando una prueba.');
    const { data: { user }, error: authError } = await withDeadline(() => client.auth.getUser(), { timeoutMs });
    if (authError || user?.id !== actor) throw new Error('La sesión cambió. Actualiza la página.');
    const existing = readRecipeTrial(storage, actor);
    if (input && existing) throw new Error('Revisa la prueba pendiente antes de guardar otra.');
    const pending = existing ?? (input ? { actor, recipeId: input.recipeId ?? crypto.randomUUID(), trialId: crypto.randomUUID(), values: { ...input.values } } : null);
    if (!pending) throw new Error('No hay una prueba pendiente.');
    const key = recipeTrialKey(actor), raw = JSON.stringify(pending);
    storage.setItem(key, raw);
    const v = pending.values;
    const { data, error } = await withDeadline(() => client.rpc('pos_save_smoothies_recipe_trial', {
      p_recipe: pending.recipeId, p_trial: pending.trialId, p_name: v.name, p_ingredients: v.ingredients,
      p_method: v.method, p_changes: v.changes,
    }), { timeoutMs });
    if (error) {
      if (isDefinitiveWriteRejection(error.code) && storage.getItem(key) === raw) storage.removeItem(key);
      throw new Error(error.message);
    }
    const trial = data as RecipeTrial;
    if (!trial || trial.id !== pending.trialId || trial.recipe_id !== pending.recipeId || !Number.isInteger(trial.number) || trial.number < 1
      || trial.ingredients !== v.ingredients.trim() || trial.method !== v.method.trim() || trial.changes !== v.changes.trim()) {
      throw new Error('No se confirmó la prueba. Revisa el guardado pendiente.');
    }
    if (storage.getItem(key) !== raw) throw new Error('La prueba cambió en otra ventana. Actualiza la página.');
    storage.removeItem(key);
    return { pending, trial };
  });
}
