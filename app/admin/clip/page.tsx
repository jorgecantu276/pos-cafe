'use client';

import { useCallback, useRef, useState } from 'react';
import { useResource } from '@/lib/use-resource';
import { withDeadline } from '@/lib/request-deadline';
import { SettingsGroup, SettingsRow, SettingsNotice } from '../Settings';

type PendingPayment = {request_id:string;cashier:string;state:string;total:number;pager_number:number|null;provider_id:string|null;created_at:string};
export default function ClipPage() {
  const [data,setData] = useState<{enabled:boolean;payments:PendingPayment[]}>({enabled:false,payments:[]});
  const [ids,setIds] = useState<Record<string,string>>({}), [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
  const lock = useRef(false);
  const load = useCallback(async () => {
    const response = await withDeadline(() => fetch('/api/payments/clip',{cache:'no-store',signal:AbortSignal.timeout(12000)}));
    const result = await response.json();
    if (!response.ok) throw Error(result.error || 'No se pudo consultar CLIP.');
    return result;
  },[]);
  const {loading,error,reload} = useResource(load,{enabled:false,payments:[]},setData);
  const reconcile = async (payment:PendingPayment) => {
    if (lock.current) return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      const response = await withDeadline(() => fetch('/api/payments/clip',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'reconcile',requestId:payment.request_id,providerId:ids[payment.request_id] || payment.provider_id}),signal:AbortSignal.timeout(20000)}),{timeoutMs:20000});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'No se pudo comprobar el pago.');
      setMessage(result.message); await reload();
    } catch (failure) {setMessage(failure instanceof Error ? failure.message : 'No se pudo comprobar el pago.');}
    finally {lock.current=false;setBusy(false);}
  };
  return <div className="settings-page"><div className="settings-page-heading"><h1>Terminal CLIP</h1><button type="button" className="settings-button" disabled={loading||busy} onClick={()=>void reload()}>Actualizar</button></div>
    {error&&<SettingsNotice error>{error}</SettingsNotice>}{message&&<SettingsNotice>{message}</SettingsNotice>}
    <SettingsGroup title="Conexión"><SettingsRow label="Cobro automático" detail={!loading&&!error ? data.enabled ? 'El POS envía el importe a la terminal.' : 'Cobra en la terminal y registra el pago con tarjeta.' : undefined}><span className={`settings-badge${!loading&&!error&&data.enabled?' is-on':''}`}>{loading?'Consultando…':error?'No disponible':data.enabled?'Activado':'Desactivado'}</span></SettingsRow></SettingsGroup>
    <SettingsGroup title="Pagos por revisar">
      {!loading&&!error&&data.payments.length===0&&<p className="settings-empty">Sin pagos pendientes.</p>}
      {loading&&<p className="settings-empty" role="status">Cargando pagos…</p>}
      {data.payments.map(payment=><article key={payment.request_id} className="settings-job">
        <div className="settings-job-heading"><h3>{payment.cashier}</h3><span className="settings-value">${Number(payment.total).toFixed(2)}</span></div>
        <p>{new Date(payment.created_at).toLocaleString('es-MX',{timeZone:'America/Matamoros'})}{payment.pager_number?` · Control ${payment.pager_number}`:''}</p>
        <SettingsNotice>No vuelvas a cobrar. Comprueba este pago en CLIP.</SettingsNotice>
        <div className="settings-editor"><label>Folio del pago en CLIP<input value={ids[payment.request_id]??payment.provider_id??''} disabled={busy} placeholder="pinpad-…" onChange={event=>setIds(previous=>({...previous,[payment.request_id]:event.target.value.trim()}))}/></label><div><button type="button" className="is-primary" disabled={busy||!(ids[payment.request_id]||payment.provider_id)} onClick={()=>void reconcile(payment)}>Comprobar pago</button></div></div>
        <details className="settings-details"><summary>Detalles del pago</summary><div><p className="break-all">Referencia: {payment.request_id}</p><p>Comprobar el pago no envía otro cobro.</p></div></details>
      </article>)}
    </SettingsGroup>
  </div>;
}
