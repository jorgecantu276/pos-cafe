'use client';

import { useState, useEffect } from 'react';
import { Moon, Sun, Printer, Check, Laptop, Palette } from 'lucide-react';

export default function AjustesPage() {
  const [theme, setTheme] = useState('light');
  const [ticketData, setTicketData] = useState({
    storeName: 'Mi Café',
    address: 'Calle Falsa 123, Ciudad',
    phone: '55 1234 5678',
    footerMessage: '¡Gracias por tu visita! ☕️'
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // ESTILO DE ANIMACIÓN "CUPERTINO" (INFALIBLE)
  const animationStyles = `
    @keyframes appleFadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    .animate-cupertino {
      animation: appleFadeInUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    }
  `;

  return (
    <>
      <style>{animationStyles}</style>
      <div className="max-w-[900px] mx-auto space-y-12 py-10 animate-cupertino">
        
        <header className="space-y-1">
          <h2 className="text-4xl font-semibold text-[#1d1d1f] tracking-tight">Ajustes</h2>
          <p className="text-[#86868b] text-lg font-medium">Configura la identidad y el entorno de tu sistema.</p>
        </header>

        {/* SECCIÓN: APARIENCIA */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <Palette size={18} className="text-[#86868b]" />
            <h4 className="font-semibold text-[#1d1d1f] text-sm uppercase tracking-wider">Aspecto</h4>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { id: 'light', name: 'Claro', icon: <Sun size={20}/>, bg: 'bg-white' },
              { id: 'dark', name: 'Oscuro', icon: <Moon size={20}/>, bg: 'bg-[#1c1c1e]' },
              { id: 'system', name: 'Automático', icon: <Laptop size={20}/>, bg: 'bg-gradient-to-r from-white to-[#1c1c1e]' }
            ].map((mode) => (
              <button 
                key={mode.id}
                onClick={() => setTheme(mode.id)}
                className={`p-6 rounded-[28px] border-2 transition-all flex flex-col items-center gap-4 group ${
                  theme === mode.id 
                  ? 'border-[#0071e3] bg-white shadow-[0_8px_40px_rgba(0,0,0,0.04)]' 
                  : 'border-transparent bg-white hover:border-slate-200'
                }`}
              >
                <div className={`w-20 h-14 rounded-xl ${mode.bg} border border-slate-200 flex items-center justify-center shadow-sm overflow-hidden`}>
                  <div className={theme === mode.id ? 'text-[#0071e3]' : 'text-slate-300 group-hover:text-slate-400'}>{mode.icon}</div>
                </div>
                <span className={`text-[13px] font-semibold ${theme === mode.id ? 'text-[#1d1d1f]' : 'text-[#86868b]'}`}>{mode.name}</span>
              </button>
            ))}
          </div>
        </section>

        {/* SECCIÓN: TICKET TÉRMICO */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <Printer size={18} className="text-[#86868b]" />
            <h4 className="font-semibold text-[#1d1d1f] text-sm uppercase tracking-wider">Impresión</h4>
          </div>

          <div className="bg-white rounded-[28px] shadow-[0_8px_40px_rgba(0,0,0,0.04)] border border-slate-100/50 p-10 grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-[#86868b] ml-1 uppercase tracking-tight">Nombre comercial</label>
                <input 
                  type="text" 
                  className="w-full bg-[#f5f5f7] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-[#0071e3]/10 transition-all outline-none text-[#1d1d1f]"
                  value={ticketData.storeName}
                  onChange={(e) => setTicketData({...ticketData, storeName: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-[#86868b] ml-1 uppercase tracking-tight">Dirección de sucursal</label>
                <input 
                  type="text" 
                  className="w-full bg-[#f5f5f7] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-[#0071e3]/10 transition-all outline-none text-[#1d1d1f]"
                  value={ticketData.address}
                  onChange={(e) => setTicketData({...ticketData, address: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-[#86868b] ml-1 uppercase tracking-tight">Mensaje final</label>
                <textarea 
                  className="w-full bg-[#f5f5f7] border-none rounded-2xl p-4 text-sm font-medium focus:ring-2 focus:ring-[#0071e3]/10 transition-all outline-none h-28 text-[#1d1d1f] resize-none"
                  value={ticketData.footerMessage}
                  onChange={(e) => setTicketData({...ticketData, footerMessage: e.target.value})}
                />
              </div>
            </div>

            {/* PREVIEW TICKET */}
            <div className="bg-[#f5f5f7] rounded-[24px] p-8 flex flex-col items-center justify-center border border-slate-200/20 shadow-inner">
              <div className="bg-white w-full max-w-[210px] shadow-xl p-6 text-center font-mono text-[10px] space-y-3 relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-slate-100 border-b border-dashed border-slate-200"></div>
                <div className="pt-2">
                  <p className="font-bold text-[13px] uppercase tracking-tighter leading-tight text-[#1d1d1f]">{ticketData.storeName}</p>
                  <p className="text-[#86868b] text-[9px] mt-1">{ticketData.address}</p>
                </div>
                <div className="border-b border-dashed border-slate-100 my-4"></div>
                <div className="space-y-1 text-left text-[#1d1d1f]">
                  <div className="flex justify-between uppercase">
                    <span>1x Japanese Coffee</span>
                    <span>$65.00</span>
                  </div>
                </div>
                <div className="border-b border-dashed border-slate-100 my-4"></div>
                <div className="flex justify-between font-bold text-[12px] text-[#1d1d1f]">
                  <span>TOTAL</span>
                  <span>$65.00</span>
                </div>
                <p className="mt-6 text-[9px] text-[#86868b] italic leading-relaxed">
                  {ticketData.footerMessage}
                </p>
              </div>
              <p className="mt-4 text-[10px] font-bold text-slate-300 uppercase tracking-widest">Vista Previa</p>
            </div>
          </div>
        </section>

        {/* BOTÓN GUARDAR */}
        <div className="flex justify-end pb-20">
          <button className="bg-[#0071e3] text-white px-8 py-3 rounded-full text-[13px] font-semibold hover:bg-[#0077ed] transition-all active:scale-95 flex items-center gap-2 shadow-lg shadow-[#0071e3]/20">
            <Check size={16} /> Guardar cambios
          </button>
        </div>
      </div>
    </>
  );
}