'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Utensils, Plus, Trash2, Loader2, Save, ChevronRight, Beaker } from 'lucide-react';

export default function RecetasPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<any | null>(null);
  const [recipeItems, setRecipeItems] = useState<any[]>([]); // Insumos de la receta
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      const { data } = await supabase.from('products').select('*').order('name');
      setProducts(data || []);
      setLoading(false);
    };
    fetchProducts();
  }, []);

  if (loading) return <Loader2 className="animate-spin text-blue-600 mx-auto mt-20" />;

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <header>
        <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Configuración de Recetas</h2>
        <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-1">Vincula productos con insumos</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* LISTA DE PRODUCTOS */}
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden h-[60vh] flex flex-col">
          <div className="p-6 border-b border-slate-50 bg-slate-50/50">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Selecciona un producto</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
            {products.map(p => (
              <button 
                key={p.id} 
                onClick={() => setSelectedProduct(p)}
                className={`w-full p-5 text-left flex justify-between items-center transition-all ${selectedProduct?.id === p.id ? 'bg-blue-600 text-white' : 'hover:bg-slate-50'}`}
              >
                <span className="font-bold text-sm">{p.name}</span>
                <ChevronRight size={16} className={selectedProduct?.id === p.id ? 'opacity-100' : 'opacity-20'} />
              </button>
            ))}
          </div>
        </div>

        {/* EDITOR DE RECETA */}
        <div className="lg:col-span-2 bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8 min-h-[60vh]">
          {selectedProduct ? (
            <div className="space-y-8">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-2xl font-black text-slate-900">{selectedProduct.name}</h3>
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-widest">Ingredientes de la Receta</p>
                </div>
                <button className="bg-slate-900 text-white px-6 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 hover:scale-105 transition-all">
                  <Plus size={16}/> Añadir Insumo
                </button>
              </div>

              <div className="bg-slate-50 rounded-[2rem] p-8 text-center border-2 border-dashed border-slate-200">
                <Beaker size={40} className="mx-auto mb-4 text-slate-300" />
                <p className="text-slate-400 font-bold text-sm italic">"The alchemy of coffee..."</p>
                <p className="text-xs text-slate-300 mt-2 max-w-xs mx-auto">Define cuánto café, leche o jarabe utiliza este producto para descontarlo automáticamente del stock.</p>
              </div>

              <div className="flex justify-end pt-4">
                <button className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-bold flex items-center gap-2 shadow-lg shadow-emerald-100">
                  <Save size={18}/> Guardar Receta
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
              <Utensils size={64} className="mb-4" />
              <p className="font-black uppercase tracking-[0.2em] text-sm text-center">Selecciona un producto a la izquierda <br/> para ver o editar su receta</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}