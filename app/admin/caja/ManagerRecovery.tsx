'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { drawerWrite, recoverDrawerRequest, hasDrawerRequest, type DrawerStatus } from '@/lib/drawer';
import { loadShiftSummary, type ShiftSummary } from '@/lib/shift-state';
import { errorMessage } from '@/lib/pos-types';
import { SettingsGroup, SettingsRow, SettingsNotice } from '../Settings';
import { receivedCashMXN } from '@/lib/usd-cash';

export default function ManagerRecovery({actor,status,reload}:{actor:string;status:DrawerStatus;reload:()=>Promise<unknown>}) {
  const [summary,setSummary]=useState<ShiftSummary|null>(null),[count,setCount]=useState(''),[usd,setUSD]=useState(''),[reason,setReason]=useState('');
  const [confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState(false),[storageError,setStorageError]=useState(false);
  const checkPending=useCallback(()=>{try{setPending(hasDrawerRequest(localStorage,actor,'manager_close'));setStorageError(false);}catch{setPending(true);setStorageError(true);}},[actor]);
  useEffect(()=>{void Promise.resolve().then(checkPending);},[checkPending]);
  const total=receivedCashMXN(Number(count),Number(usd||0),summary?.exchange_rate??0);
  const inspect=async()=>{if(!status.active)return;setBusy(true);setMessage('');try{setSummary(await loadShiftSummary(supabase,status.active.id));setConfirmed(false);}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}};
  const save=async(recover=false)=>{
    if(busy)return;setBusy(true);setMessage('');
    try{
      const existing=hasDrawerRequest(localStorage,actor,'manager_close');
      if(recover){
        if(!existing)throw new Error('No hay un cierre pendiente.');
        await recoverDrawerRequest(supabase,localStorage,actor,'manager_close');
      }else{
        if(existing)throw new Error('Revisa el cierre pendiente antes de iniciar otro.');
        if(!summary||!confirmed||!count.trim()||!Number.isFinite(total)||total<0||Number(count)<0||Number(usd)<0
          ||Math.round(Number(count)*100)/100!==Number(count)||Math.round(Number(usd||0)*100)/100!==Number(usd||0)
          ||reason.trim().length<3)throw new Error('Revisa el efectivo contado y escribe el motivo.');
        if(!confirm(`¿Cerrar el turno de ${status.active?.cashier_name} con $${total.toFixed(2)} MXN? Diferencia: $${(total-summary.expected_cash).toFixed(2)}.`))return;
        await drawerWrite(supabase,localStorage,actor,'manager_close',{register:summary.register_id,counted:total,count_confirmed:true,reason:reason.trim(),preview:{cash_sales:summary.cash_sales,total_sales:summary.total_sales,expenses_revision:summary.expenses_revision}});
      }
      setSummary(null);setMessage('Turno cerrado.');checkPending();await reload();
    }catch(error){setMessage(errorMessage(error));checkPending();}finally{setBusy(false);}
  };
  if(!status.active&&!pending&&!storageError&&!message)return null;
  return <SettingsGroup title="Turno">
    {status.active&&<SettingsRow label="Cajero"><span className="settings-value">{status.active.cashier_name}</span></SettingsRow>}
    {pending&&<div className="settings-editor"><SettingsNotice error={storageError}>{storageError?'No se pudo leer el cierre pendiente. Vuelve a abrir esta pantalla.':'Hay un cierre sin confirmar.'}</SettingsNotice><div><button disabled={busy} onClick={()=>void save(true)}>Revisar cierre pendiente</button></div></div>}
    {status.active&&!pending&&<details className="settings-disclosure"><summary>Cerrar turno de otro cajero</summary><div>
      {!summary||status.active.id!==summary.register_id?<><p>Úsalo si el cajero no puede terminar su turno.</p><button disabled={busy} onClick={()=>void inspect()}>{busy?'Cargando…':'Revisar turno'}</button></>:<div className="settings-editor">
        <div className="settings-row"><div className="settings-row-copy"><strong>Efectivo esperado</strong></div><span className="settings-value">${summary.expected_cash.toFixed(2)} MXN</span></div>
        <div className="settings-fields"><label>Efectivo contado MXN<input aria-label="Conteo del responsable MXN" inputMode="decimal" disabled={busy} value={count} onChange={e=>{setCount(e.target.value);setConfirmed(false);}}/></label><label>Dólares contados<input inputMode="decimal" disabled={busy} value={usd} onChange={e=>{setUSD(e.target.value);setConfirmed(false);}}/></label></div>
        <div className="settings-row"><div className="settings-row-copy"><strong>Total contado</strong><span>1 USD = {summary.exchange_rate} MXN</span></div><span className="settings-value">${Number.isFinite(total)?total.toFixed(2):'—'} MXN</span></div>
        <label>Motivo del cierre<input value={reason} maxLength={300} disabled={busy} onChange={e=>setReason(e.target.value)}/></label>
        <a className="settings-button" href="/admin/impresion">Comprobar impresión</a>
        <label className="settings-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Conté el dinero y revisé pedidos e impresiones pendientes.</label>
        <div className="settings-actions"><button className="is-danger" disabled={busy||!confirmed||!count.trim()||reason.trim().length<3} onClick={()=>void save()}>Cerrar turno</button><button disabled={busy} onClick={()=>setSummary(null)}>Cancelar</button></div>
      </div>}
    </div></details>}
    {message&&<div className="settings-editor"><SettingsNotice>{message}</SettingsNotice></div>}
  </SettingsGroup>;
}
