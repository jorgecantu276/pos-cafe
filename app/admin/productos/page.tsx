'use client';
import { posProfile } from '@/lib/pos-profile';

import ProductPhoto from '@/components/ProductPhoto';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { type ProductRow, type ExtraRow, errorMessage } from '@/lib/pos-types';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { announceCatalogChange, readCatalogRequest, saveCatalogChange, type CatalogChange } from '@/lib/catalog-management';
import { supabase } from '@/lib/supabase';
import { canonicalCatalogPhoto } from '@/lib/supabase-connection';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { PlusCircle, Trash2, Loader2 } from 'lucide-react';
import CatalogEditor, { type CatalogForm } from './CatalogEditor';
import SmoothiesImport from './SmoothiesImport';
import WeeklySpecial from './WeeklySpecial';
import OpeningCount from './OpeningCount';
import './smoothies-catalog.css';

type PrivateRecipe = { id: string; name: string; product_id: string | null };
const noRecipes: PrivateRecipe[] = [];

async function uploadCatalogPhoto(file: File, extension: string) {
  const bucket = supabase.storage.from('catalog-photos');
  const path = `${crypto.randomUUID()}.${extension}`;
  const { error } = await bucket.upload(path, file, { contentType: file.type });
  if (error) throw error;
  return canonicalCatalogPhoto(path, process.env.NEXT_PUBLIC_SUPABASE_URL || '');
}

export default function ProductosPage() {
  return <Suspense fallback={<p role="status">Cargando catálogo…</p>}><CatalogPage /></Suspense>;
}

function CatalogPage() {
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'items' | 'extras'>('items');
  const [showForm, setShowForm] = useState(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [status,setStatus]=useState<'active'|'inactive'>('active');
  const [editingRevision,setEditingRevision]=useState<number|null>(null);
  const [importRevision, setImportRevision] = useState(0);
  
  const [editingId, setEditingId] = useState<string | number | null>(null);

  const smoothies = posProfile.id === 'smoothies';
  const focusedId = smoothies ? searchParams.get('producto') : null;
  const initialFormState: CatalogForm = { name: '', price: '', category: smoothies ? 'Smoothies' : 'Bebidas', phase: smoothies ? 'Extras' : 'Tamaño', customizable: !smoothies, image_url: '', wizard_steps: [], productIds: [] };
  const [formData, setFormData] = useState(initialFormState);

  const loadCatalog = useCallback(async (signal: AbortSignal) => {
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) throw Error('Inicia sesión.');
    const [products, extras] = await Promise.all([
      supabase.from('products').select('*').order('name').abortSignal(signal),
      supabase.from('extras').select('*').order('phase').abortSignal(signal),
    ]);
    if (products.error) throw products.error;
    if (extras.error) throw extras.error;
    // Reading an unreadable request must keep editing blocked, with recovery visible.
    let pending = true;
    try { pending = Boolean(readCatalogRequest(localStorage, auth.data.user.id)); } catch { /* preserve recovery */ }
    return { actor: auth.data.user.id, pending, products: (products.data || []) as ProductRow[], extras: (extras.data || []) as ExtraRow[] };
  }, []);
  const applyCatalog = useCallback((data: { pending: boolean }) => setPending(data.pending), []);
  const { data: { actor, products, extras }, loading, error: loadError, reload: fetchData } = useResource(loadCatalog, { actor: '', pending: false, products: [] as ProductRow[], extras: [] as ExtraRow[] }, applyCatalog);

  const loadRecipes = useCallback(async (signal: AbortSignal): Promise<PrivateRecipe[]> => {
    if (!smoothies) return noRecipes;
    const { data, error } = await supabase.rpc('pos_smoothies_recipes').abortSignal(signal);
    if (error || !Array.isArray(data)) throw Error('No se pudieron consultar tus recetas.');
    return data;
  }, [smoothies]);
  const { data: recipes, loading: recipesLoading, error: recipesError, reload: reloadRecipes } = useResource(loadRecipes, noRecipes);
  const recipeFor = (productId: string) => recipes.find(recipe => recipe.product_id === productId);
  const focusedProduct = focusedId ? products.find(product => product.id === focusedId) : undefined;

  useEffect(() => {
    if (!smoothies || !actor) return;
    const openSpecial = () => {
      if (window.location.hash !== '#especial-semanal') return;
      const panel = document.getElementById('especial-semanal');
      if (panel instanceof HTMLDetailsElement) {
        panel.open = true;
        panel.scrollIntoView({ block: 'start' });
      }
    };
    openSpecial();
    window.addEventListener('hashchange', openSpecial);
    return () => window.removeEventListener('hashchange', openSpecial);
  }, [smoothies, actor]);


  const handleEdit = (item: ProductRow | ExtraRow, type: 'items' | 'extras') => {
    if (saving.current || pending) return;
    setActiveTab(type);
    setEditingId(item.id);
    setEditingRevision(item.catalog_revision??0);
    setFormData({
      name: item.name || '',
      price: String(item.price ?? ''),
      category: 'category' in item ? item.category || 'Bebidas' : 'Bebidas',
      phase: 'phase' in item ? item.phase : 'Tamaño',
      customizable: 'customizable' in item && item.customizable === true,
      image_url: 'image_url' in item ? item.image_url || '' : '',
      wizard_steps: 'wizard_steps' in item ? item.wizard_steps || [] : [],
      productIds: 'phase' in item ? item.applicable_product_ids ?? products
        .filter(product => product.customizable && product.wizard_steps?.includes(item.phase))
        .map(product => product.id) : [],
    });
    setMessage('');
    setShowForm(true);
  };

  const handleToggleForm = () => {
    if (saving.current || pending) return;
    setEditingId(null);setEditingRevision(null);setFormData(initialFormState); setMessage(''); setShowForm(true);
  };
  const closeForm = () => { if (!saving.current) setShowForm(false); };

  const commitChange = async (change?: CatalogChange) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setMessage('');
    try {
      await saveCatalogChange(supabase, localStorage, actor, change);
      announceCatalogChange();
      setPending(false); setMessage('Cambios guardados.');
      setShowForm(false);
      setEditingId(null);
      setFormData(initialFormState);
      await fetchData();
    } catch (error: unknown) {
      setMessage(`No se confirmó el guardado. ${errorMessage(error)}`);
      try { setPending(Boolean(readCatalogRequest(localStorage, actor))); } catch { setPending(true); }
    } finally { saving.current = false; setBusy(false); }
  };
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving.current || pending) return;
    const price = Number(formData.price);
    const minimum = smoothies && activeTab === 'items' ? 0.01 : 0;
    if (!formData.name.trim() || !formData.price.trim() || !Number.isFinite(price) || price < minimum || price > 1000000 || Math.round(price * 100) / 100 !== price) {
      setMessage(minimum ? 'Escribe un nombre y un precio mayor a cero, con hasta dos decimales.' : 'Revisa nombre y precio. Usa hasta dos decimales.'); return;
    }
    await commitChange({ kind: activeTab === 'items' ? 'product' : 'extra', action: 'save', id: editingId ? String(editingId) : null,...(editingId?{revision:editingRevision??0}:{}),
      fields: activeTab === 'items' ? { name: formData.name.trim(), price, category: formData.category.trim(), customizable: formData.customizable,
        image_url: formData.image_url.trim(), wizard_steps: formData.customizable ? formData.wizard_steps : [] }
        : { name: formData.name.trim(), price, phase: formData.phase.trim(),
          ...(smoothies ? { applicable_product_ids: formData.productIds ?? [] } : {}) } });
  };
  const deactivate = async (id: string, kind: CatalogChange['kind']) => {
    if (saving.current || pending) return;
    const item=(kind==='product'?products:extras).find(item=>item.id===id);if(!item)return;
    if (confirm('¿Desactivar este producto o extra? Su historial se conservará.')) await commitChange({ kind, action: 'deactivate', id,revision:item.catalog_revision??0 });
  };
  const reactivate=async(item:ProductRow|ExtraRow,kind:CatalogChange['kind'])=>{if(!saving.current&&!pending)await commitChange({kind,action:'reactivate',id:item.id,revision:item.catalog_revision??0});};

  // Las opciones habituales también se muestran cuando todavía no hay productos.
  const defaultCategories = smoothies ? ['Smoothies', 'Varios'] : ['Bebidas', 'Postres', 'Varios'];
  const uniqueCategories = Array.from(new Set([...defaultCategories, ...products.map(p => p.category).filter((c): c is string => Boolean(c))]));

  const defaultPhases = smoothies ? ['Extras', 'Leche alternativa'] : ['Tamaño', 'Tipo de Leche', 'Endulzante', 'Sabor'];
  const uniquePhases = Array.from(new Set([...defaultPhases, ...extras.map(e => e.phase)]));

  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
  const matches = (name: string) => normalize(name).includes(normalize(search));
  const activeProducts = products.filter(p => status==='active'?p.is_active !== false:p.is_active===false);
  const activeExtras = extras.filter(e => status==='active'?e.active !== false:e.active===false);
  const filteredProducts = activeProducts.filter(p => matches(p.name) && (!groupFilter || (p.category || 'Otros') === groupFilter));
  const filteredExtras = activeExtras.filter(e => matches(e.name) && (!groupFilter || e.phase === groupFilter));
  const filterGroups = [...new Set(activeTab === 'items' ? activeProducts.map(p => p.category || 'Otros') : activeExtras.map(e => e.phase))].sort((a, b) => a.localeCompare(b, 'es'));
  const shown = activeTab === 'items' ? filteredProducts.length : filteredExtras.length;
  const total = activeTab === 'items' ? activeProducts.length : activeExtras.length;
  const selectTab = (type: 'items' | 'extras') => { setActiveTab(type); setSearch(''); setGroupFilter(''); };

  if (loadError) return <LoadFailure message={loadError} retry={fetchData} />;
  if (loading && !actor) return <Loader2 aria-label="Cargando catálogo" className="animate-spin text-blue-600 mx-auto mt-20" />;

  return <div className="workspace-catalog-admin">
    {!showForm && message && <p role="status" className="admin-form-message">{message}</p>}
    {pending && <div role="alert" className="admin-recovery"><p>Hay cambios sin confirmar. Comprueba el guardado antes de continuar.</p><button type="button" disabled={busy} onClick={() => void commitChange()}>{busy ? 'Confirmando…' : 'Comprobar guardado'}</button></div>}
    <fieldset disabled={busy || pending} className="catalog-workspace">
      <header className="workspace-admin-heading-row"><h1>Catálogo</h1><button type="button" onClick={handleToggleForm} className="admin-primary-button"><PlusCircle size={20}/>{`Nuevo ${activeTab === 'items' ? 'producto' : 'extra'}`}</button></header>
      {smoothies && <div className="smoothies-catalog-guide">
        <p>Revisa el nombre, el precio y los extras. Los productos en venta aparecen en caja.</p>
        <Link href="/admin/recetario">Ir a mis recetas</Link>
      </div>}
      {focusedId && (focusedProduct ? <section className="smoothies-product-focus" aria-labelledby="focused-product-title">
        <div><span className="smoothies-product-state">{focusedProduct.is_active === false ? 'Fuera de venta' : 'En venta'}</span>
          <h2 id="focused-product-title">{focusedProduct.name}</h2>
          <p>${Number(focusedProduct.price).toFixed(2)} MXN · {focusedProduct.is_active === false ? 'Revisa el producto y elige Poner en venta cuando esté listo.' : 'Ya aparece en el menú de caja.'}</p>
        </div>
        <div className="smoothies-product-next">
          <button type="button" className="admin-secondary-button" disabled={showForm || loading} onClick={() => handleEdit(focusedProduct, 'items')}>Editar producto</button>
          {focusedProduct.is_active === false ? <button type="button" className="admin-primary-button" disabled={showForm || loading} onClick={() => void reactivate(focusedProduct, 'product')}>Poner en venta</button> : <Link className="admin-primary-button" href="/">Ver en caja</Link>}
          {!recipesLoading && !recipesError && recipeFor(focusedProduct.id) && <Link href={`/admin/recetario?receta=${encodeURIComponent(recipeFor(focusedProduct.id)!.id)}`}>Volver a la receta</Link>}
        </div>
      </section> : <p role="status" className="admin-form-message">{loading ? 'Buscando el producto…' : 'No se encontró este producto. Puedes buscarlo en el catálogo.'}</p>)}
      {smoothies && recipesError && <p role="alert" className="smoothies-catalog-note">No se pudieron consultar los enlaces a tus recetas. <button type="button" className="admin-secondary-button" disabled={recipesLoading} onClick={() => void reloadRecipes()}>Reintentar</button></p>}
      <div className="catalog-toolbar">
        <div className="catalog-scopes">
        <div className="admin-segmented" role="group" aria-label="Tipo de catálogo"><button type="button" aria-pressed={activeTab === 'items'} onClick={() => selectTab('items')}>Productos</button><button type="button" aria-pressed={activeTab === 'extras'} onClick={() => selectTab('extras')}>Extras</button></div>
        <div className="admin-segmented" role="group" aria-label="Estado del catálogo"><button type="button" aria-pressed={status==='active'} onClick={()=>{setStatus('active');setGroupFilter('');}}>{smoothies ? 'En venta' : 'Activos'}</button><button type="button" aria-pressed={status==='inactive'} onClick={()=>{setStatus('inactive');setGroupFilter('');}}>{smoothies ? 'Fuera de venta' : 'Inactivos'}</button></div>
        </div>
        <div className="catalog-filters"><label className="admin-field">{activeTab === 'items' ? 'Buscar producto' : 'Buscar extra'}<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Escribe el nombre"/></label><label className="admin-field">{activeTab === 'items' ? 'Categoría' : 'Grupo'}<select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}><option value="">{activeTab === 'items' ? 'Todas las categorías' : 'Todos los grupos'}</option>{filterGroups.map(group => <option key={group}>{group}</option>)}</select></label></div>
        <p role="status" className="catalog-result-count">{shown} de {total} {activeTab === 'items' ? 'productos' : 'extras'}</p>
      </div>
      <div className="catalog-list" aria-label={activeTab === 'items' ? 'Productos del catálogo' : 'Extras del catálogo'}>
        {activeTab === 'items' ? filteredProducts.map(p => <div key={p.id} className="catalog-row">
          <div className="catalog-item">{p.image_url && <ProductPhoto product={p} width={44} height={44} illustrativeFallback={false} className="catalog-product-photo"/>}<div className="catalog-copy"><h2>{p.name}</h2><p>{p.category || 'Otros'}{p.customizable && !!p.wizard_steps?.length && ` · ${p.wizard_steps.join(' · ')}`}</p></div></div>
          <strong className="catalog-price">${Number(p.price).toFixed(2)}</strong><div className="catalog-actions">
            {(smoothies || p.is_active !== false) && <button type="button" className="admin-secondary-button" aria-label={`Editar ${p.name}`} title={`Editar ${p.name}`} onClick={() => handleEdit(p, 'items')}>Editar</button>}
            {smoothies && !recipesLoading && !recipesError && recipeFor(p.id) && <Link className="admin-secondary-button" href={`/admin/recetario?receta=${encodeURIComponent(recipeFor(p.id)!.id)}`} aria-label={`Ver receta de ${p.name}`}>Receta</Link>}
            {p.is_active===false ? <button type="button" className="admin-secondary-button" aria-label={`${smoothies ? 'Poner en venta' : 'Reactivar'} ${p.name}`} onClick={()=>void reactivate(p,'product')}>{smoothies ? 'Poner en venta' : 'Reactivar'}</button>
              : <button type="button" className="admin-icon-button admin-danger-icon" aria-label={`Desactivar ${p.name}`} title={`Desactivar ${p.name}`} onClick={() => void deactivate(p.id, 'product')}><Trash2 size={19}/></button>}
          </div>
        </div>) : filteredExtras.map(e => <div key={e.id} className="catalog-row"><div className="catalog-copy"><h2>{e.name}</h2><p>{e.phase}</p></div><strong className="catalog-price">+ ${Number(e.price).toFixed(2)}</strong><div className="catalog-actions">{e.active===false?<button type="button" className="admin-secondary-button" aria-label={`Reactivar ${e.name}`} onClick={()=>void reactivate(e,'extra')}>Reactivar</button>:<><button type="button" className="admin-secondary-button" aria-label={`Editar ${e.name}`} title={`Editar ${e.name}`} onClick={() => handleEdit(e, 'extras')}>Editar</button><button type="button" className="admin-icon-button admin-danger-icon" aria-label={`Desactivar ${e.name}`} title={`Desactivar ${e.name}`} onClick={() => void deactivate(e.id, 'extra')}><Trash2 size={19}/></button></>}</div></div>)}
        {!shown && <p className="catalog-empty">{total ? 'No hay resultados con esta búsqueda y filtro.' : `No hay ${activeTab === 'items' ? 'productos' : 'extras'} ${status==='active'?'activos':'inactivos'}.`}</p>}
      </div>
    </fieldset>
    {smoothies && <section className="smoothies-catalog-setup" aria-labelledby="smoothies-setup-title">
      <h2 id="smoothies-setup-title">Preparar la barra</h2>
      <p>Abre solo lo que necesites cambiar.</p>
      <WeeklySpecial products={products} disabled={busy || pending || showForm} />
      <SmoothiesImport disabled={busy || pending || showForm} onImported={() => {
        announceCatalogChange();
        setImportRevision(revision => revision + 1);
        void fetchData();
      }} />
      <OpeningCount importRevision={importRevision} />
    </section>}
    {showForm && <CatalogEditor assignmentProducts={smoothies ? products : undefined} minimumPrice={smoothies && activeTab === 'items' ? 0.01 : 0} type={activeTab} editing={editingId !== null} values={formData} onChange={setFormData} categories={uniqueCategories} phases={uniquePhases} busy={busy} pending={pending} message={message} onUploadPhoto={uploadCatalogPhoto} onSubmit={handleSave} onClose={closeForm}/>}
  </div>;
}
