'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Calculator, TrendingUp, AlertCircle, 
  Loader2, ArrowUpRight, BarChart3, Info
} from 'lucide-react';

export default function CosteoPage() {
  const [productsCost, setProductsCost] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCostData = async () => {
    setLoading(true);
    try {
      const { data: products, error } = await supabase
        .from('products')
        .select(`
          id, name, price, category,
          product_recipes (
            quantity_required,
            supplies ( cost_per_unit )
          )
        `);

      if (error) throw error;

      if (products) {
        const processed = products.map(p => {
          const totalCost = p.product_recipes?.reduce((acc: number, r: any) => {
            const unitCost = r.supplies?.cost_per_unit || 0;
            return acc + (Number(r.quantity_required) * Number(unitCost));
          }, 0) || 0;
          
          const margin = p.price > 0 ? ((p.price - totalCost) / p.price) * 100 : 0;
          return { ...p, totalCost, margin };
        });
        setProductsCost(processed.sort((a, b) => b.margin - a.margin));
      }
    } catch (err) {
      console.error("Error en costeo:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCostData(); }, []);

  const avgMargin = productsCost.length > 0 
    ? productsCost.reduce((acc, curr) => acc + curr.margin, 0) / productsCost.length 
    : 0;

  if (loading) return (
    <div className="flex h-[60vh] items-center justify-center">
      <Loader2 className="animate-spin text-slate-300 w-8 h-8" strokeWidth={1.5} />
    </div>
  );

  return (
    <div className="max-w-[1100px] mx-auto space-y-12 py-10 animate-in fade-in duration-1000">
      <header className="space-y-1">
        <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Costeo</h2>
        <p className="text-[#86868b] text-lg font-medium">Análisis de rentabilidad y márgenes de utilidad.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50">
          <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight mb-2">Margen Promedio</p>
          <div className="flex items-baseline gap-1">
            <h3 className="text-5xl font-semibold text-[#1d1d1f] tracking-tighter">{avgMargin.toFixed(0)}%</h3>
          </div>
          <div className="mt-4 flex items-center gap-2 text-[#06c167] bg-[#06c167]/10 w-fit px-3 py-1 rounded-full text-xs font-semibold">
            <TrendingUp size={14} /> Saludable
          </div>
        </div>

        <div className="bg-white p-8 rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 flex flex-col justify-between">
          <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight mb-2">Top Rentabilidad</p>
          <h3 className="text-xl font-semibold text-[#1d1d1f] truncate">{productsCost[0]?.name || '---'}</h3>
          <p className="text-[#0066cc] text-sm font-medium mt-1 flex items-center gap-1 group cursor-pointer">
            Ver detalle <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </p>
        </div>

        <div className="bg-[#f5f5f7] p-8 rounded-[24px] flex flex-col justify-between border border-transparent">
          <div className="flex justify-between items-start">
            <p className="text-[13px] font-semibold text-[#86868b] uppercase tracking-tight">Alertas</p>
            <Info size={18} className="text-[#86868b]" />
          </div>
          <p className="text-[#1d1d1f] font-medium text-sm leading-relaxed mt-4">
            {productsCost.filter(p => p.margin < 30).length} productos requieren revisión de precios.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-[24px] shadow-[0_4px_24px_rgba(0,0,0,0.04)] border border-slate-100/50 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-50 flex items-center gap-2">
            <BarChart3 size={18} className="text-[#1d1d1f]" />
            <h4 className="font-semibold text-[#1d1d1f]">Desglose de productos</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[13px] font-semibold text-[#86868b] border-b border-slate-50">
                <th className="px-8 py-5 font-semibold">Producto</th>
                <th className="px-8 py-5 text-center font-semibold">Venta</th>
                <th className="px-8 py-5 text-center font-semibold">Costo</th>
                <th className="px-8 py-5 text-right font-semibold">Margen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {productsCost.map(p => (
                <tr key={p.id} className="hover:bg-[#f5f5f7]/50 transition-colors">
                  <td className="px-8 py-6">
                    <p className="font-semibold text-[#1d1d1f]">{p.name}</p>
                    <p className="text-[11px] text-[#86868b] font-medium uppercase tracking-wider">{p.category}</p>
                  </td>
                  <td className="px-8 py-6 text-center text-[#1d1d1f] font-medium">${Number(p.price).toFixed(2)}</td>
                  <td className="px-8 py-6 text-center text-[#86868b] font-medium">${p.totalCost.toFixed(2)}</td>
                  <td className="px-8 py-6 text-right">
                    <span className={`inline-block px-3 py-1 rounded-full text-[12px] font-semibold ${
                      p.margin > 60 ? 'text-[#06c167] bg-[#06c167]/10' : 
                      p.margin > 30 ? 'text-[#0066cc] bg-[#0066cc]/10' : 'text-[#ff3b30] bg-[#ff3b30]/10'
                    }`}>
                      {p.margin.toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}