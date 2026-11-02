'use client';

import { useCallback, useRef, useState } from 'react';
import { useResource } from '@/lib/use-resource';
import { withDeadline } from '@/lib/request-deadline';

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
      if (!response.ok) throw Error(result.error || 'No se confirmó el pago.');
      setMessage(result.message); await reload();
    } catch (failure) {setMessage(failure instanceof Error ? failure.message : 'No se confirmó el pago.');}
    finally {lock.current=false;setBusy(false);}
  };
  return <div className="max-w-3xl space-y-5"><h1 className="text-2xl font-bold">Terminal CLIP</h1>
    <p>{data.enabled ? 'Cobro automático configurado.' : 'Cobro manual. La conexión automática está desactivada o falta configurarla.'}</p>
    <button type="button" className="rounded-xl border px-4 py-3" disabled={loading||busy} onClick={()=>void reload()}>Actualizar estado</button>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {!loading&&!error&&data.payments.length===0&&<p>No hay pagos CLIP pendientes.</p>}
    {data.payments.map(payment=><section key={payment.request_id} className="rounded-2xl border bg-white p-5 space-y-3">
      <h2 className="font-bold">{payment.cashier} · ${Number(payment.total).toFixed(2)}{payment.pager_number ? ` · Control ${payment.pager_number}` : ''}</h2>
      <p>Revisa este pago antes de iniciar otro cobro. Verificar consulta CLIP; no envía otro cargo.</p>
      <label className="block">Identificador del pago en CLIP<input className="mt-2 w-full rounded-xl border p-3" value={ids[payment.request_id]??payment.provider_id??''}
        disabled={busy} placeholder="pinpad-…" onChange={event=>setIds(previous=>({...previous,[payment.request_id]:event.target.value.trim()}))}/></label>
      <button type="button" className="rounded-xl bg-blue-700 text-white px-4 py-3" disabled={busy||!(ids[payment.request_id]||payment.provider_id)} onClick={()=>void reconcile(payment)}>Verificar con CLIP</button>
      <details><summary>Detalles del registro</summary><p className="break-all">Solicitud: {payment.request_id}</p><p>{new Date(payment.created_at).toLocaleString('es-MX',{timeZone:'America/Matamoros'})}</p></details>
    </section>)}
  </div>;
}
