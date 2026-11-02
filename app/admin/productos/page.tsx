'use client';

import ProductPhoto from '@/components/ProductPhoto';

import { type ProductRow, type ExtraRow, errorMessage } from '@/lib/pos-types';

import { useCallback, useRef, useState } from 'react';
import { announceCatalogChange, readCatalogRequest, saveCatalogChange, type CatalogChange } from '@/lib/catalog-management';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { PlusCircle, Trash2, Edit2, Loader2, Layers } from 'lucide-react';

export default function ProductosPage() {
  const [activeTab, setActiveTab] = useState<'items' | 'extras'>('items');
  const [showForm, setShowForm] = useState(false);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  
  const [editingId, setEditingId] = useState<string | number | null>(null);

  // Entrada de una categoría o un grupo de extras nuevo.
  const [showNewCat, setShowNewCat] = useState(false);
  const [showNewPhase, setShowNewPhase] = useState(false);

  const initialFormState = { name: '', price: '', category: 'Bebidas', phase: 'Tamaño', customizable: true, image_url: '', wizard_steps: [] as string[] };
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


  const handleEdit = (item: ProductRow | ExtraRow, type: 'items' | 'extras') => {
    if (saving.current || pending) return;
    setActiveTab(type);
    setEditingId(item.id);
    setFormData({
      name: item.name || '',
      price: String(item.price ?? ''),
      category: 'category' in item ? item.category || 'Bebidas' : 'Bebidas',
      phase: 'phase' in item ? item.phase : 'Tamaño',
      customizable: 'customizable' in item && item.customizable === true,
      image_url: 'image_url' in item ? item.image_url || '' : '',
      wizard_steps: 'wizard_steps' in item ? item.wizard_steps || [] : []
    });
    setShowNewCat(false);
    setShowNewPhase(false);
    setShowForm(true);
  };

  const handleToggleForm = () => {
    if (saving.current || pending) return;
    if (showForm) {
      setEditingId(null);
      setFormData(initialFormState);
    }
    setShowNewCat(false);
    setShowNewPhase(false);
    setShowForm(!showForm);
  };

  const commitChange = async (change?: CatalogChange) => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setMessage('');
    try {
      await saveCatalogChange(supabase, localStorage, actor, change);
      announceCatalogChange();
      setPending(false); setMessage('Catálogo guardado. La caja avisará para actualizar el menú.');
      setShowForm(false);
      setEditingId(null);
      setFormData(initialFormState);
      await fetchData();
    } catch (error: unknown) {
      setMessage(`No se pudo confirmar el guardado: ${errorMessage(error)}`);
      try { setPending(Boolean(readCatalogRequest(localStorage, actor))); } catch { setPending(true); }
    } finally { saving.current = false; setBusy(false); }
  };
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving.current || pending) return;
    const price = Number(formData.price);
    if (!formData.name.trim() || !formData.price.trim() || !Number.isFinite(price) || price < 0 || price > 1000000 || Math.round(price * 100) / 100 !== price) {
      setMessage('Revisa nombre y precio. Usa hasta dos decimales.'); return;
    }
    await commitChange({ kind: activeTab === 'items' ? 'product' : 'extra', action: 'save', id: editingId ? String(editingId) : null,
      fields: activeTab === 'items' ? { name: formData.name.trim(), price, category: formData.category.trim(), customizable: formData.customizable,
        image_url: formData.image_url.trim(), wizard_steps: formData.customizable ? formData.wizard_steps : [] }
        : { name: formData.name.trim(), price, phase: formData.phase.trim() } });
  };
  const deactivate = async (id: string, kind: CatalogChange['kind']) => {
    if (saving.current || pending) return;
    if (confirm('¿Desactivar este producto o extra? Su historial se conservará.')) await commitChange({ kind, action: 'deactivate', id });
  };

  // Las opciones habituales también se muestran cuando todavía no hay productos.
  const defaultCategories = ['Bebidas', 'Postres', 'Varios'];
  const uniqueCategories = Array.from(new Set([...defaultCategories, ...products.map(p => p.category).filter((c): c is string => Boolean(c))]));

  const defaultPhases = ['Tamaño', 'Tipo de Leche', 'Endulzante', 'Sabor'];
  const uniquePhases = Array.from(new Set([...defaultPhases, ...extras.map(e => e.phase)]));

  const groupedExtras = extras.filter(extra => extra.active !== false).reduce<Record<string, ExtraRow[]>>((acc, current) => {
    if (!acc[current.phase]) acc[current.phase] = [];
    acc[current.phase].push(current);
    return acc;
  }, {});

  if (loadError) return <LoadFailure message={loadError} retry={fetchData} />;

  if (loading) return <Loader2 className="animate-spin text-blue-600 mx-auto mt-20" />;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500 pb-20">
      {message && <p role="status" className="rounded-xl border bg-white p-4">{message}</p>}
      {pending && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p>Hay un guardado sin confirmar. Recupéralo antes de hacer otro cambio.</p><button type="button" disabled={busy} onClick={() => void commitChange()} className="mt-2 rounded-xl border bg-white p-3 font-semibold">{busy ? 'Confirmando…' : 'Recuperar guardado pendiente'}</button></div>}
      <fieldset disabled={busy || pending} className="min-w-0 space-y-6">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Catálogo</h2>
          <div className="flex gap-4 mt-4">
            <button onClick={() => { setActiveTab('items'); setFormData(initialFormState); setEditingId(null); setShowForm(false); }} className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all ${activeTab === 'items' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>Productos</button>
            <button onClick={() => { setActiveTab('extras'); setFormData(initialFormState); setEditingId(null); setShowForm(false); }} className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all ${activeTab === 'extras' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>Extras</button>
          </div>
        </div>
        <button onClick={handleToggleForm} className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg">
          <PlusCircle size={20}/> {showForm ? 'Cancelar' : `Nuevo ${activeTab === 'items' ? 'Producto' : 'Extra'}`}
        </button>
      </header>

      {showForm && (
        <form onSubmit={handleSave} className="bg-white p-8 rounded-[2rem] shadow-xl border border-blue-50 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start animate-in fade-in slide-in-from-top-4">
          <input type="text" placeholder="Nombre" value={formData.name} required className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" onChange={e => setFormData({...formData, name: e.target.value})} />
          <input type="number" step="0.01" placeholder="Precio" value={formData.price} required className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" onChange={e => setFormData({...formData, price: e.target.value})} />
          
          {activeTab === 'items' ? (
            <>
              <input type="url" placeholder="Enlace de la foto (opcional)" value={formData.image_url} className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" onChange={e => setFormData({...formData, image_url: e.target.value})} />
              <p className="text-sm text-slate-500">Pega el enlace de la foto del producto. Si no hay una foto disponible, la caja muestra su nombre y precio.</p>
              
              {/* Categoría del producto */}
              <div className="relative w-full">
                {showNewCat ? (
                  <div className="flex gap-2">
                    <input type="text" placeholder="Nueva Categoría" required className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})} />
                    <button type="button" onClick={() => { setShowNewCat(false); setFormData({...formData, category: uniqueCategories[0] as string}); }} className="bg-slate-200 text-slate-600 px-4 rounded-xl font-bold hover:bg-slate-300">X</button>
                  </div>
                ) : (
                  <select className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full cursor-pointer" value={formData.category} onChange={e => { if(e.target.value === '___NEW___') { setShowNewCat(true); setFormData({...formData, category: ''}); } else { setFormData({...formData, category: e.target.value}); } }}>
                    {uniqueCategories.map(cat => <option key={cat as string} value={cat as string}>{cat}</option>)}
                    <option value="___NEW___">+ Crear nueva categoría</option>
                  </select>
                )}
              </div>

              <div className="lg:col-span-4 flex flex-col gap-4 mt-2">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-600 bg-slate-50 p-4 rounded-2xl cursor-pointer hover:bg-slate-100 transition-colors w-fit">
                  <input type="checkbox" checked={formData.customizable} onChange={e => setFormData({...formData, customizable: e.target.checked})} className="w-5 h-5 rounded text-blue-600" />
                  Permitir elegir opciones de preparación
                </label>

                {formData.customizable && (
                  <div className="p-5 bg-blue-50/50 rounded-2xl border border-blue-100 animate-in fade-in zoom-in-95">
                    <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                      <Layers size={16} className="text-blue-600"/> Opciones de este producto
                    </p>
                    <div className="flex flex-wrap gap-4">
                      {uniquePhases.map(phase => (
                        <label key={phase as string} className="flex items-center gap-2 text-sm text-slate-600 font-bold bg-white px-4 py-2 rounded-xl shadow-sm cursor-pointer hover:border-blue-300 border border-transparent transition-all">
                          <input
                            type="checkbox"
                            checked={formData.wizard_steps?.includes(phase as string)}
                            onChange={(e) => {
                              const steps = formData.wizard_steps || [];
                              if (e.target.checked) setFormData({...formData, wizard_steps: [...steps, phase as string]});
                              else setFormData({...formData, wizard_steps: steps.filter(s => s !== phase)});
                            }}
                            className="w-4 h-4 rounded text-blue-600"
                          />
                          {phase as string}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* Grupo del extra */
            <div className="relative w-full">
                {showNewPhase ? (
                  <div className="flex gap-2">
                    <input type="text" placeholder="Nuevo grupo (ej. Jarabes)" required className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" value={formData.phase} onChange={e => setFormData({...formData, phase: e.target.value})} />
                    <button type="button" onClick={() => { setShowNewPhase(false); setFormData({...formData, phase: uniquePhases[0] as string}); }} className="bg-slate-200 text-slate-600 px-4 rounded-xl font-bold hover:bg-slate-300">X</button>
                  </div>
                ) : (
                  <select className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full cursor-pointer" value={formData.phase} onChange={e => { if(e.target.value === '___NEW___') { setShowNewPhase(true); setFormData({...formData, phase: ''}); } else { setFormData({...formData, phase: e.target.value}); } }}>
                    {uniquePhases.map(phase => <option key={phase as string} value={phase as string}>{phase}</option>)}
                    <option value="___NEW___">+ Crear grupo de extras</option>
                  </select>
                )}
            </div>
          )}

          <button type="submit" className={`bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30 py-3 ${activeTab === 'items' ? 'lg:col-span-4' : 'lg:col-span-1'}`}>
            {busy ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar nuevo'}
          </button>
        </form>
      )}

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
        {activeTab === 'items' ? (
          products.filter(p=>p.is_active!==false).map(p => (
            <div key={p.id} className="p-6 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-blue-50/50 rounded-2xl flex items-center justify-center text-blue-500 overflow-hidden flex-shrink-0 border border-blue-100 shadow-sm">
                  <ProductPhoto product={p} width={56} height={56} className="w-full h-full object-cover" />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                    {p.name}
                    {p.category === 'Bebidas' && p.customizable === false && (
                       <span className="text-[9px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase font-black tracking-wider">Sin opciones</span>
                    )}
                  </h4>
                  <p className="text-[11px] font-black text-blue-600 uppercase tracking-widest">{p.category} — <span className="text-slate-400">${Number(p.price).toFixed(2)}</span></p>
                  
                  {p.customizable && p.wizard_steps && p.wizard_steps.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {p.wizard_steps.map((step: string) => (
                        <span key={step} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">{step}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                <button aria-label={`Editar ${p.name}`} onClick={() => handleEdit(p, 'items')} className="bg-slate-100 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors p-2.5 rounded-xl">
                  <Edit2 size={18}/>
                </button>
                <button aria-label={`Desactivar ${p.name}`} onClick={() => void deactivate(p.id, 'product')} className="bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors p-2.5 rounded-xl">
                  <Trash2 size={18}/>
                </button>
              </div>
            </div>
          ))
        ) : (
          Object.keys(groupedExtras).map(phaseName => (
            <div key={phaseName} className="mb-4 last:mb-0">
              <div className="bg-slate-50 px-6 py-3 border-y border-slate-100">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{phaseName}</h3>
              </div>
              {groupedExtras[phaseName].map((e) => (
                <div key={e.id} className="p-6 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group">
                  <div>
                    <h4 className="font-bold text-slate-800 text-lg">{e.name}</h4>
                    <p className="text-sm font-bold text-slate-400">+ ${Number(e.price).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button aria-label={`Editar ${e.name}`} onClick={() => handleEdit(e, 'extras')} className="bg-slate-100 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors p-2.5 rounded-xl">
                      <Edit2 size={18}/>
                    </button>
                    <button aria-label={`Desactivar ${e.name}`} onClick={() => void deactivate(e.id, 'extra')} className="bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors p-2.5 rounded-xl">
                      <Trash2 size={18}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      </fieldset>
    </div>
  );
}
