'use client';

import Link from 'next/link';
import { BookOpen, GitCompareArrows, LockKeyhole, Plus, Search } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { announceCatalogChange } from '@/lib/catalog-management';
import { errorMessage } from '@/lib/pos-types';
import { normalizeMenuText } from '@/lib/menu-cards';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';

type Recipe = { id: string; name: string; product_id: string | null; trial_count: number };
type Trial = { id: string; number: number; ingredients: string; method: string; changes: string; created_at: string };
type TrialForm = { name: string; ingredients: string; method: string; changes: string };
const blank: TrialForm = { name: '', ingredients: '', method: '', changes: '' };
const date = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Matamoros' });

export default function RecipeBook() {
  const load = useCallback(async (signal: AbortSignal): Promise<Recipe[]> => {
    const { data, error } = await supabase.rpc('pos_smoothies_recipes').abortSignal(signal);
    if (error) throw new Error(error.message);
    return data;
  }, []);
  const { data: recipes, loading, error, reload, setData } = useResource(load, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const visibleRecipes = recipes.filter(row => normalizeMenuText(row.name).includes(normalizeMenuText(search)));
  const navigation = useRef({ busy: false, dirty: false });
  const recipe = recipes.find(row => row.id === selected);
  const trackEdit = useCallback((busy: boolean, dirty: boolean) => { navigation.current = { busy, dirty }; }, []);

  function open(id: string | null) {
    if (id ? id === selected : creating) return;
    if (navigation.current.busy || (navigation.current.dirty && !confirm('¿Salir de esta prueba sin guardar los cambios?'))) return;
    setSelected(id);
    setCreating(id === null);
  }

  function updateRecipe(row: Recipe) {
    setData(previous => [row, ...previous.filter(item => item.id !== row.id)]);
    setSelected(row.id);
    setCreating(false);
  }

  return <div className="recipe-book">
    <header className="recipe-book-heading">
      <div><h1>Recetario privado</h1><p><LockKeyhole size={15} aria-hidden="true" /> Solo tú puedes ver tus pruebas y notas con tu cuenta.</p></div>
      <button type="button" className="admin-primary-button" disabled={loading || !!error || creating} onClick={() => open(null)}>
        <Plus size={18} aria-hidden="true" /> Nueva receta
      </button>
    </header>
    {loading ? <p role="status">Cargando recetario…</p> : error ? <div role="alert" className="recipe-book-message">
      <p>No se pudo abrir el recetario.</p><button type="button" className="admin-secondary-button" onClick={() => void reload()}>Reintentar</button>
    </div> : <div className="recipe-book-grid">
      <aside className="recipe-book-panel" aria-label="Mis recetas"><h2>Mis recetas</h2>
        {!!recipes.length && <label className="recipe-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Buscar receta" placeholder="Buscar receta" value={search} onChange={event => setSearch(event.target.value)} /></label>}
        {visibleRecipes.length ? <ul>{visibleRecipes.map(row => <li key={row.id}>
          <button type="button" aria-pressed={row.id === selected} onClick={() => open(row.id)}>
            <strong>{row.name}</strong><span>{row.trial_count} {row.trial_count === 1 ? 'prueba' : 'pruebas'} · {row.product_id ? 'En catálogo' : 'En pruebas'}</span>
          </button>
        </li>)}</ul> : <p>{recipes.length ? 'No hay recetas con ese nombre.' : 'Todavía no hay recetas.'}</p>}
      </aside>
      {creating || recipe ? <RecipeDetail key={recipe?.id ?? 'new'} recipe={recipe} onChange={updateRecipe} onEditState={trackEdit} /> :
        <section className="recipe-book-panel recipe-book-empty"><BookOpen size={24} aria-hidden="true" />
          <h2>{recipes.length ? 'Elige una receta' : 'Guarda tu primera prueba'}</h2>
          <p>{recipes.length ? 'Abre una receta para ver lo que probaste y lo que quieres cambiar.' : 'Anota las cantidades y lo que ajustarías la próxima vez.'}</p>
        </section>}
    </div>}
  </div>;
}

function RecipeDetail({ recipe, onChange, onEditState }: {
  recipe?: Recipe; onChange: (row: Recipe) => void; onEditState: (busy: boolean, dirty: boolean) => void;
}) {
  const currentRecipeId = recipe?.id;
  const load = useCallback(async (signal: AbortSignal): Promise<Trial[]> => {
    if (!currentRecipeId) return [];
    const { data, error } = await supabase.rpc('pos_smoothies_recipe_trials', { p_recipe: currentRecipeId }).abortSignal(signal);
    if (error) throw new Error(error.message);
    return data;
  }, [currentRecipeId]);
  const { data: trials, loading, error, reload, setData } = useResource(load, []);
  const [form, setForm] = useState<TrialForm | null>(recipe ? null : blank);
  const [publication, setPublication] = useState<{ name: string; price: string } | null>(null);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<{ left: string; right: string } | null>(null);
  const lock = useRef(false);
  const attempt = useRef<{ recipeId: string; trialId: string; values: TrialForm } | null>(null);
  const latest = trials[0];
  const dirty = Boolean((form && (form.name !== (recipe?.name ?? '') || form.ingredients !== (latest?.ingredients ?? '')
    || form.method !== (latest?.method ?? '') || form.changes)) || (publication && (publication.price || publication.name !== recipe?.name)));
  useEffect(() => { onEditState(busy, dirty); }, [busy, dirty, onEditState]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!target || target.target === '_blank' || target.hasAttribute('download') || target.origin !== location.origin || target.pathname === location.pathname) return;
      if (busy || !confirm('¿Salir del recetario sin guardar los cambios?')) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', onLink, true);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('click', onLink, true);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [busy, dirty]);

  function startTrial() {
    setMessage('');
    setFailure('');
    setForm({ name: recipe?.name ?? '', ingredients: latest?.ingredients ?? '', method: latest?.method ?? '', changes: '' });
  }

  async function saveTrial(event: FormEvent) {
    event.preventDefault();
    if (!form || lock.current) return;
    const values = { ...form, name: (recipe?.name ?? form.name).trim(), ingredients: form.ingredients.trim() };
    if (!values.name || !values.ingredients) { setFailure('Escribe el nombre y los ingredientes con sus cantidades.'); return; }
    if (!attempt.current || JSON.stringify(attempt.current.values) !== JSON.stringify(values)) {
      const priorId = attempt.current?.values.name === values.name ? attempt.current.recipeId : undefined;
      attempt.current = { recipeId: recipe?.id ?? priorId ?? crypto.randomUUID(), trialId: crypto.randomUUID(), values };
    }
    const { recipeId, trialId } = attempt.current;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setFailure('');
    try {
      const { data, error } = await supabase.rpc('pos_save_smoothies_recipe_trial', {
        p_recipe: recipeId, p_trial: trialId, p_name: values.name, p_ingredients: values.ingredients,
        p_method: values.method, p_changes: values.changes,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (error || data?.id !== trialId) throw new Error(error?.message ?? 'Intenta guardar de nuevo.');
      const trial: Trial = data;
      setData(previous => [trial, ...previous.filter(row => row.id !== trial.id)].sort((a, b) => b.number - a.number));
      onChange({ id: recipeId, name: values.name, product_id: recipe?.product_id ?? null, trial_count: Math.max(trial.number, recipe?.trial_count ?? 0) });
      setForm(null);
      setMessage('Prueba guardada.');
      attempt.current = null;
    } catch (error) { setFailure(`No se confirmó el guardado. ${errorMessage(error)}`); }
    finally { lock.current = false; setBusy(false); }
  }

  async function publish(event: FormEvent) {
    event.preventDefault();
    if (!recipe || !latest || !publication || lock.current) return;
    const name = publication.name.trim();
    const price = Number(publication.price.trim().replace(',', '.'));
    if (!name || !Number.isFinite(price) || price <= 0 || price > 1000000 || Math.round(price * 100) / 100 !== price) {
      setFailure('Escribe el nombre de venta y un precio en pesos con hasta dos decimales.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setFailure('');
    try {
      const { data, error } = await supabase.rpc('pos_publish_smoothies_recipe', {
        p_recipe: recipe.id, p_trial: latest.id, p_name: name, p_price: price,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (error || typeof data !== 'string') throw new Error(error?.message ?? 'Vuelve a intentar.');
      onChange({ ...recipe, product_id: data });
      setPublication(null);
      setMessage('Bebida preparada en Catálogo → Inactivos. Revísala y actívala cuando quieras venderla.');
      announceCatalogChange();
    } catch (error) { setFailure(`No se confirmó el cambio. ${errorMessage(error)}`); }
    finally { lock.current = false; setBusy(false); }
  }

  return <section className="recipe-book-panel recipe-book-detail">
    <header><h2>{recipe?.name ?? 'Nueva receta'}</h2>{recipe?.product_id && <Link href="/admin/productos">Revisar en catálogo</Link>}</header>
    {form && <form onSubmit={saveTrial}>
      {!recipe && <label className="admin-field">Nombre de la receta<input required maxLength={100} value={form.name} disabled={busy} placeholder="Mango con coco" onChange={event => setForm({ ...form, name: event.target.value })} /></label>}
      <label className="admin-field">Ingredientes y cantidades<textarea required rows={4} maxLength={4000} value={form.ingredients} disabled={busy} placeholder={'150 g de mango\n120 ml de leche de coco'} onChange={event => setForm({ ...form, ingredients: event.target.value })} /></label>
      <label className="admin-field">Cómo la preparaste (opcional)<textarea rows={2} maxLength={4000} value={form.method} disabled={busy} onChange={event => setForm({ ...form, method: event.target.value })} /></label>
      <label className="admin-field">Qué cambiarías (opcional)<textarea rows={3} maxLength={4000} value={form.changes} disabled={busy} placeholder="Probar con menos hielo para que quede más cremosa." onChange={event => setForm({ ...form, changes: event.target.value })} /></label>
      <div className="recipe-book-actions"><button type="submit" className="admin-primary-button" disabled={busy}>{busy ? 'Guardando…' : 'Guardar prueba'}</button>
        {recipe && <button type="button" className="admin-secondary-button" disabled={busy} onClick={() => { if (dirty && !confirm('¿Descartar los cambios de esta prueba?')) return; setForm(null); setFailure(''); }}>Cancelar</button>}
      </div>
    </form>}
    {publication && <form onSubmit={publish} className="recipe-publication">
      <h3>Preparar bebida para la venta</h3><p>Guarda el nombre y el precio. Podrás revisar el producto y activarlo desde Catálogo. Tus pruebas se quedan aquí.</p>
      <label className="admin-field">Nombre en el menú<input required maxLength={100} value={publication.name} disabled={busy} onChange={event => setPublication({ ...publication, name: event.target.value })} /></label>
      <label className="admin-field">Precio de venta (MXN)<input required inputMode="decimal" maxLength={12} value={publication.price} disabled={busy} onChange={event => setPublication({ ...publication, price: event.target.value })} /></label>
      <div className="recipe-book-actions"><button type="submit" className="admin-primary-button" disabled={busy}>Guardar en catálogo</button><button type="button" className="admin-secondary-button" disabled={busy} onClick={() => { setPublication(null); setFailure(''); }}>Cancelar</button></div>
    </form>}
    {failure && <p className="recipe-book-message" role="alert">{failure}</p>}
    {message && <p className="recipe-book-message" role="status">{message}</p>}
    {recipe && <div className="recipe-history">
      <div className="recipe-book-actions">
        {!form && !publication && recipe.product_id === null && <button type="button" className="admin-secondary-button" disabled={!latest || loading || !!error} onClick={() => { setMessage(''); setFailure(''); setPublication({ name: recipe.name, price: '' }); }}>Preparar para venta</button>}
        {!form && !publication && <button type="button" className="admin-primary-button" disabled={loading || !!error} onClick={startTrial}>Nueva prueba</button>}
        {trials.length > 1 && !loading && !error && <button type="button" className="admin-secondary-button" aria-expanded={comparison !== null} onClick={() =>
          setComparison(comparison ? null : { left: trials[1].id, right: trials[0].id })}><GitCompareArrows size={17} aria-hidden="true" />{comparison ? 'Ver historial' : 'Comparar pruebas'}</button>}
      </div>
      {loading ? <p role="status">Cargando pruebas…</p> : error ? <div role="alert" className="recipe-book-message"><p>No se pudieron abrir las pruebas.</p><button type="button" onClick={() => void reload()}>Reintentar</button></div> :
        comparison ? <div className="recipe-comparison" aria-label="Comparación de pruebas">{(['left', 'right'] as const).map((side, index) => {
          const selectedTrial = trials.find(trial => trial.id === comparison[side]) ?? trials[index];
          const otherTrial = trials.find(trial => trial.id === comparison[side === 'left' ? 'right' : 'left']);
          return <section key={side}>
            <label className="admin-field">{index === 0 ? 'Primera versión' : 'Segunda versión'}
              <select value={selectedTrial.id} onChange={event => setComparison({ ...comparison, [side]: event.target.value })}>
                {trials.map(trial => <option key={trial.id} value={trial.id}>Prueba {trial.number} · {date.format(new Date(trial.created_at))}</option>)}
              </select>
            </label>
            <TrialDetails trial={selectedTrial} compareWith={otherTrial} />
          </section>;
        })}</div> : trials.map((trial, index) => <details key={trial.id} open={index === 0 || undefined}>
          <summary><strong>Prueba {trial.number}</strong><span>{date.format(new Date(trial.created_at))}</span></summary>
          <TrialDetails trial={trial} />
        </details>)}
    </div>}
  </section>;
}

function TrialDetails({ trial, compareWith }: { trial: Trial; compareWith?: Trial }) {
  const fields = [['ingredients', 'Ingredientes y cantidades'], ['method', 'Preparación'], ['changes', 'Qué cambiaría']] as const;
  return <dl>{fields.filter(([key]) => trial[key] || compareWith?.[key]).map(([key, label]) =>
    <div key={key} className={compareWith && trial[key] !== compareWith[key] ? 'recipe-difference' : undefined}>
      <dt>{label}</dt><dd>{trial[key] || '—'}</dd>
    </div>)}</dl>;
}
