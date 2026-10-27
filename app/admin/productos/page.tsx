'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { PlusCircle, Trash2, Edit2, Package, Loader2, Layers } from 'lucide-react';

export default function ProductosPage() {
  const [activeTab, setActiveTab] = useState<'items' | 'extras'>('items');
  const [products, setProducts] = useState<any[]>([]);
  const [extras, setExtras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  
  const [editingId, setEditingId] = useState<string | number | null>(null);

  // 🟢 Estados para mostrar el input de "Crear Nueva"
  const [showNewCat, setShowNewCat] = useState(false);
  const [showNewPhase, setShowNewPhase] = useState(false);

  const initialFormState = { name: '', price: '', category: 'Bebidas', stock: 10, phase: 'Tamaño', customizable: true, image_url: '', wizard_steps: [] as string[] };
  const [formData, setFormData] = useState(initialFormState);

  const fetchData = async () => {
    setLoading(true);
    const { data: p } = await supabase.from('products').select('*').order('name');
    const { data: e } = await supabase.from('extras').select('*').order('phase');
    setProducts(p || []);
    setExtras(e || []);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleEdit = (item: any, type: 'items' | 'extras') => {
    setActiveTab(type);
    setEditingId(item.id);
    setFormData({
      name: item.name || '',
      price: item.price || '',
      category: item.category || 'Bebidas',
      stock: item.stock || 10,
      phase: item.phase || 'Tamaño',
      customizable: item.customizable !== false,
      image_url: item.image_url || '',
      wizard_steps: item.wizard_steps || [] 
    });
    setShowNewCat(false);
    setShowNewPhase(false);
    setShowForm(true);
  };

  const handleToggleForm = () => {
    if (showForm) {
      setEditingId(null);
      setFormData(initialFormState);
    }
    setShowNewCat(false);
    setShowNewPhase(false);
    setShowForm(!showForm);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (activeTab === 'items') {
        const payload = { 
          name: formData.name, 
          price: parseFloat(formData.price),
          category: formData.category,
          stock: formData.stock,
          customizable: formData.customizable,
          image_url: formData.image_url,
          wizard_steps: formData.customizable ? formData.wizard_steps : [] 
        };

        if (editingId) {
          const { error } = await supabase.from('products').update(payload).eq('id', editingId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('products').insert([payload]);
          if (error) throw error;
        }
      } else {
        const payload = { 
          name: formData.name, 
          price: parseFloat(formData.price), 
          phase: formData.phase 
        };

        if (editingId) {
          const { error } = await supabase.from('extras').update(payload).eq('id', editingId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('extras').insert([payload]);
          if (error) throw error;
        }
      }
      
      setShowForm(false);
      setEditingId(null);
      setFormData(initialFormState);
      fetchData();
    } catch (error: any) {
      console.error("Error al guardar:", error);
      alert(`Hubo un error al guardar: ${error.message}`);
    }
  };

  // 🟢 EXTRAYENDO CATEGORÍAS Y FASES ÚNICAS (Mantenemos las opciones por defecto siempre visibles)
  const defaultCategories = ['Bebidas', 'Postres', 'Varios'];
  const uniqueCategories = Array.from(new Set([...defaultCategories, ...products.map(p => p.category)]));

  const defaultPhases = ['Tamaño', 'Tipo de Leche', 'Endulzante', 'Sabor'];
  const uniquePhases = Array.from(new Set([...defaultPhases, ...extras.map(e => e.phase)]));

  const groupedExtras = extras.reduce((acc: any, current) => {
    if (!acc[current.phase]) acc[current.phase] = [];
    acc[current.phase].push(current);
    return acc;
  }, {});

  if (loading) return <Loader2 className="animate-spin text-blue-600 mx-auto mt-20" />;

  return (
    <div className="space-y-6 animate-in slide-in-from-bottom-2 duration-500 pb-20">
      <header className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter">GESTIÓN DE CATÁLOGO</h2>
          <div className="flex gap-4 mt-4">
            <button onClick={() => { setActiveTab('items'); setFormData(initialFormState); setEditingId(null); setShowForm(false); }} className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all ${activeTab === 'items' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>1.1 Productos</button>
            <button onClick={() => { setActiveTab('extras'); setFormData(initialFormState); setEditingId(null); setShowForm(false); }} className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all ${activeTab === 'extras' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400'}`}>1.2 Extras</button>
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
              <input type="url" placeholder="URL de la imagen (Opcional)" value={formData.image_url} className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" onChange={e => setFormData({...formData, image_url: e.target.value})} />
              
              {/* 🟢 SELECTOR DE CATEGORÍAS (PRODUCTOS) */}
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
                  Habilitar preparación guiada (Wizard) para este producto
                </label>

                {formData.customizable && (
                  <div className="p-5 bg-blue-50/50 rounded-2xl border border-blue-100 animate-in fade-in zoom-in-95">
                    <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                      <Layers size={16} className="text-blue-600"/> ¿Qué opciones aplican para este producto?
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
            /* 🟢 SELECTOR DE FASES (EXTRAS) */
            <div className="relative w-full">
                {showNewPhase ? (
                  <div className="flex gap-2">
                    <input type="text" placeholder="Nueva Fase (Ej: Jarabes)" required className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full" value={formData.phase} onChange={e => setFormData({...formData, phase: e.target.value})} />
                    <button type="button" onClick={() => { setShowNewPhase(false); setFormData({...formData, phase: uniquePhases[0] as string}); }} className="bg-slate-200 text-slate-600 px-4 rounded-xl font-bold hover:bg-slate-300">X</button>
                  </div>
                ) : (
                  <select className="p-3 rounded-xl bg-slate-50 border-none text-sm font-medium outline-none focus:ring-2 focus:ring-blue-600/20 transition-all w-full cursor-pointer" value={formData.phase} onChange={e => { if(e.target.value === '___NEW___') { setShowNewPhase(true); setFormData({...formData, phase: ''}); } else { setFormData({...formData, phase: e.target.value}); } }}>
                    {uniquePhases.map(phase => <option key={phase as string} value={phase as string}>{phase}</option>)}
                    <option value="___NEW___">+ Crear nueva fase / categoría</option>
                  </select>
                )}
            </div>
          )}

          <button type="submit" className={`bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-500/30 py-3 ${activeTab === 'items' ? 'lg:col-span-4' : 'lg:col-span-1'}`}>
            {editingId ? 'Actualizar Cambios' : 'Guardar Nuevo'}
          </button>
        </form>
      )}

      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
        {activeTab === 'items' ? (
          products.map(p => (
            <div key={p.id} className="p-6 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-blue-50/50 rounded-2xl flex items-center justify-center text-blue-500 overflow-hidden flex-shrink-0 border border-blue-100 shadow-sm">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package size={24} className="opacity-50" />
                  )}
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 flex items-center gap-2 text-lg">
                    {p.name}
                    {p.category === 'Bebidas' && p.customizable === false && (
                       <span className="text-[9px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase font-black tracking-wider">Sin Wizard</span>
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
                <button onClick={() => handleEdit(p, 'items')} className="bg-slate-100 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors p-2.5 rounded-xl">
                  <Edit2 size={18}/>
                </button>
                <button onClick={async () => { if(confirm('¿Seguro que deseas eliminar este producto?')) { await supabase.from('products').delete().eq('id', p.id); fetchData(); } }} className="bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors p-2.5 rounded-xl">
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
              {groupedExtras[phaseName].map((e: any) => (
                <div key={e.id} className="p-6 flex items-center justify-between border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors group">
                  <div>
                    <h4 className="font-bold text-slate-800 text-lg">{e.name}</h4>
                    <p className="text-sm font-bold text-slate-400">+ ${Number(e.price).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEdit(e, 'extras')} className="bg-slate-100 text-slate-500 hover:text-blue-600 hover:bg-blue-50 transition-colors p-2.5 rounded-xl">
                      <Edit2 size={18}/>
                    </button>
                    <button onClick={async () => { if(confirm('¿Seguro que deseas eliminar este extra?')) { await supabase.from('extras').delete().eq('id', e.id); fetchData(); } }} className="bg-slate-100 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-colors p-2.5 rounded-xl">
                      <Trash2 size={18}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}