'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Ticket, PlusCircle, Trash2, Tag, Calendar, Loader2 } from 'lucide-react';

export default function CuponesPage() {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCoupons = async () => {
      const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
      setCoupons(data || []);
      setLoading(false);
    };
    fetchCoupons();
  }, []);

  if (loading) return <Loader2 className="animate-spin text-blue-600 mx-auto mt-20" />;

  return (
    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tighter uppercase">Cupones y Promos</h2>
          <p className="text-slate-400 text-sm font-bold uppercase tracking-widest mt-1">Activa el motor de ventas</p>
        </div>
        <button className="bg-slate-900 text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2">
          <PlusCircle size={18}/> Crear Cupón
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {coupons.map(coupon => (
          <div key={coupon.id} className="bg-white border-2 border-dashed border-slate-200 p-6 rounded-[2.5rem] flex justify-between items-center relative overflow-hidden">
             <div className="absolute -left-4 w-8 h-8 bg-[#F5F5F7] rounded-full"></div>
             <div className="absolute -right-4 w-8 h-8 bg-[#F5F5F7] rounded-full"></div>
             
             <div>
               <div className="flex items-center gap-2 text-blue-600 mb-1">
                 <Tag size={16} />
                 <span className="text-lg font-black tracking-tighter">{coupon.code}</span>
               </div>
               <p className="text-2xl font-black text-slate-800">
                 {coupon.discount_type === 'percentage' ? `${coupon.value}% OFF` : `$${coupon.value} DCTO`}
               </p>
               <p className="text-[10px] font-bold text-slate-400 uppercase mt-2 flex items-center gap-1">
                 <Calendar size={12}/> Expira: {coupon.expiry_date || 'Nunca'}
               </p>
             </div>

             <div className="text-right">
               <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase mb-4 ${coupon.active ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                 {coupon.active ? 'Activo' : 'Pausado'}
               </div>
               <button className="text-slate-200 hover:text-red-500 transition-colors"><Trash2 size={20}/></button>
             </div>
          </div>
        ))}
      </div>
    </div>
  );
}