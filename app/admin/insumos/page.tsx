'use client';

import { type Supply, errorMessage } from '@/lib/pos-types';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { Box, Plus, Search, AlertTriangle, Edit3, Loader2, Trash2, X } from 'lucide-react';

const CONVERSIONS: Record<string, { base: string, factor: number }> = {
  'ml': { base: 'ml', factor: 1 },
  'gr': { base: 'gr', factor: 1 },
  'pza': { base: 'pza', factor: 1 },
  'lt': { base: 'ml', factor: 1000 },
  'kg': { base: 'gr', factor: 1000 },
  'oz': { base: 'ml', factor: 29.57 }
};

export default function InsumosPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    unit: 'ml',
    current_stock: '',
    min_stock: '',
    cost_per_unit: ''
  });

  const loadSupplies = useCallback(async (signal: AbortSignal) => {
    const { data, error } = await supabase.from('supplies').select('*').order('name').abortSignal(signal);
    if (error) throw error;
    return (data || []) as Supply[];
  }, []);
  const { data: supplies, loading, error: loadError, reload: fetchSupplies } = useResource(loadSupplies, []);


  const formatDisplayStock = (amount: number, unit: string) => {
    if (unit === 'ml' && amount >= 1000) return `${(amount / 1000).toFixed(2)} lt`;
    if (unit === 'gr' && amount >= 1000) return `${(amount / 1000).toFixed(2)} kg`;
    return `${amount} ${unit}`;
  };

  // ABRIR MODAL PARA EDITAR
  const handleEdit = (supply: Supply) => {
    setEditingId(supply.id);
    // Para editar, mostramos los valores en la unidad base para evitar confusiones
    setFormData({
      name: supply.name,
      unit: supply.unit,
      current_stock: String(supply.current_stock ?? 0),
      min_stock: String(supply.min_stock ?? 0),
      cost_per_unit: String(supply.cost_per_unit ?? 0)
    });
    setIsModalOpen(true);
  };

  // BORRAR INSUMO
  const handleDelete = async (id: string) => {
    if (confirm('¿Desactivar este insumo? Las recetas que lo usan no podrán venderse hasta corregirlas. Se conserva el historial.')) {
      const { error } = await supabase.from('supplies').update({is_active:false}).eq('id', id);
      if (error) { alert('No se pudo desactivar el insumo: ' + errorMessage(error)); return; }
      fetchSupplies();
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if(editingId&&!['ml','gr','pza'].includes(formData.unit))throw new Error('La unidad anterior requiere conciliación antes de editar este insumo. No se convirtió el saldo.');
      const conversion = CONVERSIONS[formData.unit];
      const costoEnBase = parseFloat(formData.cost_per_unit) / conversion.factor;
      const minStockEnBase = parseFloat(formData.min_stock) * conversion.factor;
      if (!formData.name.trim() || ![costoEnBase, minStockEnBase].every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('Introduce un nombre e importes válidos, sin valores negativos.');
      }

      const payload = {
        name: formData.name,
        ...(!editingId ? {unit: conversion.base} : {}),
        min_stock: minStockEnBase,
        cost_per_unit: costoEnBase
      };

      if (editingId) {
        const { error } = await supabase.from('supplies').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('supplies').insert([payload]);
        if (error) throw error;
      }
      
      setIsModalOpen(false);
      setEditingId(null);
      setFormData({ name: '', unit: 'ml', current_stock: '', min_stock: '', cost_per_unit: '' });
      fetchSupplies();
    } catch (err: unknown) {
      alert("Error: " + errorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const filtered = supplies.filter(s => s.is_active!==false && s.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const lowStockCount = supplies.filter(s => Number(s.current_stock) <= Number(s.min_stock)).length;

  if (loadError) return <LoadFailure message={loadError} retry={fetchSupplies} />;

  if (loading) return <div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-slate-300 w-8 h-8" /></div>;

  return (
    <div className="max-w-[1100px] mx-auto space-y-12 py-10 animate-in fade-in duration-1000 relative">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="space-y-1">
          <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight uppercase">Materia Prima</h2>
          <p className="text-[#86868b] text-lg font-medium">Gestión de almacén e insumos operativos.</p>
        </div>
        <button onClick={() => { setEditingId(null); setFormData({name:'', unit:'ml', current_stock:'', min_stock:'', cost_per_unit:''}); setIsModalOpen(true); }} 
          className="bg-[#1d1d1f] text-white px-8 py-3.5 rounded-full font-semibold flex items-center gap-2 hover:bg-black transition-all">
          <Plus size={18} strokeWidth={2.5}/> Nuevo Insumo
        </button>
      </header>

      {/* BUSCADOR Y ALERTAS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input type="text" placeholder="Buscar insumo..." className="w-full bg-white border border-slate-100 rounded-[22px] py-5 pl-14 pr-6 outline-none shadow-[0_4px_24px_rgba(0,0,0,0.04)]"
            value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        <div className="p-6 rounded-[24px] bg-white border border-slate-100 shadow-[0_4px_24px_rgba(0,0,0,0.04)] flex items-center gap-5">
          <div className={`p-4 rounded-full ${lowStockCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}`}><AlertTriangle size={24} /></div>
          <div><p className="text-[11px] font-bold text-[#86868b] uppercase">Alertas</p><p className="text-xl font-semibold text-[#1d1d1f]">{lowStockCount} críticos</p></div>
        </div>
      </div>

      {/* LISTA */}
      <div className="bg-white rounded-[28px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 overflow-hidden divide-y divide-slate-50">
        {filtered.map(supply => (
          <div key={supply.id} className="p-6 flex flex-col md:flex-row justify-between items-center gap-6 hover:bg-[#f5f5f7]/50 transition-colors group">
            <div className="flex gap-6 items-center w-full md:w-auto">
              <div className="w-14 h-14 bg-[#f5f5f7] rounded-2xl flex items-center justify-center text-slate-400 group-hover:text-[#0066cc] group-hover:bg-[#0066cc]/10 transition-all"><Box size={24} /></div>
              <div>
                <h4 className="font-semibold text-[#1d1d1f] text-lg">{supply.name}</h4>
                <p className="text-[12px] text-slate-400">Ref: {supply.id.split('-')[0].toUpperCase()} • Costo base: ${Number(supply.cost_per_unit).toFixed(4)}</p>
              </div>
            </div>
            <div className="flex items-center gap-10 w-full md:w-auto justify-between md:justify-end">
              <div className="text-right">
                <p className={`text-2xl font-semibold tracking-tight ${Number(supply.current_stock) <= Number(supply.min_stock) ? 'text-red-600' : 'text-[#1d1d1f]'}`}>{formatDisplayStock(Number(supply.current_stock), supply.unit)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleEdit(supply)} className="p-3 text-slate-300 hover:text-[#1d1d1f] hover:bg-white rounded-full transition-all border border-transparent hover:border-slate-100 shadow-sm"><Edit3 size={20}/></button>
                <button onClick={() => handleDelete(supply.id)} className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"><Trash2 size={20}/></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-md bg-white h-full shadow-2xl animate-in slide-in-from-right duration-500 p-10 flex flex-col">
            <div className="flex justify-between items-center mb-10">
              <h3 className="text-2xl font-semibold text-[#1d1d1f]">{editingId ? 'Editar Insumo' : 'Añadir Insumo'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X/></button>
            </div>
            <form onSubmit={handleSave} className="space-y-6 flex-1">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#86868b] uppercase">Nombre del Insumo</label>
                <input required type="text" className="w-full bg-[#f5f5f7] border-none rounded-xl p-4 outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#86868b] uppercase">Unidad de Compra</label>
                  <select disabled={!!editingId} className="w-full bg-[#f5f5f7] border-none rounded-xl p-4 outline-none font-semibold" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})}>
                    <option value="ml">ml / lt / oz</option>
                    <option value="gr">gr / kg</option>
                    <option value="lt">Litros (lt)</option>
                    <option value="kg">Kilos (kg)</option>
                    <option value="oz">Onzas (oz)</option>
                    <option value="pza">Piezas (pza)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#86868b] uppercase">Costo por unidad seleccionada</label>
                  <input required type="number" step="0.0001" className="w-full bg-[#f5f5f7] border-none rounded-xl p-4 outline-none font-semibold" value={formData.cost_per_unit} onChange={e => setFormData({...formData, cost_per_unit: e.target.value})} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-sm text-slate-500">Entradas, conteos y merma en <a href="/admin/inventario" className="underline">Inventario</a>. Los insumos nuevos comienzan en cero.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#86868b] uppercase">Mínimo Alerta</label>
                  <input required type="number" step="0.01" className="w-full bg-[#f5f5f7] border-none rounded-xl p-4 outline-none font-semibold" value={formData.min_stock} onChange={e => setFormData({...formData, min_stock: e.target.value})} />
                </div>
              </div>
              <button type="submit" disabled={isSaving} className="w-full bg-[#0066cc] text-white py-4 rounded-2xl font-bold text-lg hover:bg-[#0077ed] disabled:opacity-50">
                {isSaving ? 'Guardando...' : 'Confirmar Cambios'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
