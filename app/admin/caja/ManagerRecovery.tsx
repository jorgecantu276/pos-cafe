'use client';
import {useState} from 'react';
import {supabase} from '@/lib/supabase';
import {drawerWrite,recoverDrawerRequest,hasDrawerRequest,type DrawerStatus} from '@/lib/drawer';
import {loadShiftSummary,type ShiftSummary} from '@/lib/shift-state';
import {errorMessage} from '@/lib/pos-types';

export default function ManagerRecovery({actor,status,reload}:{actor:string;status:DrawerStatus;reload:()=>Promise<unknown>}) {
  const [summary,setSummary]=useState<ShiftSummary|null>(null),[count,setCount]=useState(''),[usd,setUSD]=useState(''),[reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const total=Math.round((Number(count)+Number(usd||0)*(summary?.exchange_rate??0))*100)/100;
  const inspect=async()=>{if(!status.active)return;setBusy(true);setMessage('');try{setSummary(await loadShiftSummary(supabase,status.active.id));setConfirmed(false);}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}};
  const save=async(recover=false)=>{
    if(busy)return;setBusy(true);setMessage('');
    try{
      if(recover||hasDrawerRequest(localStorage,actor,'manager_close')){
        const result=await recoverDrawerRequest(supabase,localStorage,actor,'manager_close');if(!result)throw new Error('No hay un cierre pendiente de recuperar.');
      }else{
        if(!summary||!confirmed||!count.trim()||!Number.isFinite(total)||total<0||Number(count)<0||Number(usd)<0||reason.trim().length<3)throw new Error('Cuenta el efectivo y escribe el motivo.');
        if(!confirm(`Cerrar definitivamente el turno de ${status.active?.cashier_name} con $${total.toFixed(2)} MXN contados. Diferencia $${(total-summary.expected_cash).toFixed(2)}. Revisa cualquier orden sin cobrar o impresión pendiente. ¿Confirmar?`))return;
        await drawerWrite(supabase,localStorage,actor,'manager_close',{register:summary.register_id,counted:total,count_confirmed:true,reason:reason.trim(),preview:{cash_sales:summary.cash_sales,total_sales:summary.total_sales,expenses_revision:summary.expenses_revision}});
      }
      setSummary(null);setMessage('Cierre guardado. El cajero original conserva su historial y el responsable queda registrado. Reimprime desde Cortes de caja.');await reload();
    }catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}
  };
  return <section className="border rounded-xl bg-white p-5 space-y-3"><h2>Recuperar caja si el cajero no está disponible</h2>
    <p>Se conserva el turno a nombre del cajero original y se registra quién realizó el cierre y por qué. Cuenta el dinero y revisa ventas e impresión antes de liberar la caja.</p>
    <a href="/admin/impresion">Revisar impresión de todos los cajeros</a>
    {status.active?<><p>Turno abierto: {status.active.cashier_name}</p><button disabled={busy} className="border rounded p-3" onClick={()=>void inspect()}>Consultar turno para cierre del responsable</button></>:<p>No hay un turno abierto.</p>}
    {summary&&status.active?.id===summary.register_id&&<><p>Efectivo esperado: ${summary.expected_cash.toFixed(2)} MXN. Tipo de cambio del turno: {summary.exchange_rate}.</p>
      <label className="block">Efectivo contado MXN<input aria-label="Conteo del responsable MXN" className="border p-3 block" inputMode="decimal" disabled={busy} value={count} onChange={e=>{setCount(e.target.value);setConfirmed(false);}}/></label>
      <label className="block">Dólares contados<input className="border p-3 block" inputMode="decimal" disabled={busy} value={usd} onChange={e=>{setUSD(e.target.value);setConfirmed(false);}}/></label>
      <p>Total contado: ${Number.isFinite(total)?total.toFixed(2):'—'} MXN.</p>
      <label className="block">Motivo del cierre por responsable<input className="border p-3 block w-full" value={reason} maxLength={300} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
      <label className="block"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Terminé de contar y revisé órdenes e impresión pendientes.</label>
      <button disabled={busy||!confirmed||!count.trim()||reason.trim().length<3} className="border rounded p-3" onClick={()=>void save()}>Cerrar turno y liberar caja</button></>}
    <button disabled={busy} className="border rounded p-3" onClick={()=>void save(true)}>Recuperar cierre del responsable pendiente</button>
    {message&&<p role="status">{message}</p>}
  </section>;
}
