'use client';

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { drawerWrite, hasDrawerRequest, loadDrawerStatus, recoverDrawerRequest } from '@/lib/drawer';
import { errorMessage } from '@/lib/pos-types';
import LoadFailure from '@/app/LoadFailure';

interface Handoff { id: string; from_name: string; to_name: string; delivered: number; received: number | null; difference: number | null; note: string; created_at: string; accepted_at: string | null }
export default function DrawerAdmin() {
  const [rate, setRate] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const load = useCallback(async (signal: AbortSignal) => {
    const auth = await supabase.auth.getUser(); if (!auth.data.user || auth.error) throw new Error('Inicia sesión.');
    const [status, history] = await Promise.all([loadDrawerStatus(supabase, signal), supabase.rpc('pos_drawer_history').abortSignal(signal)]);
    if (history.error) throw history.error;
    if (!Array.isArray(history.data)) throw new Error('No se pudo consultar el historial de entregas.');
    return { actor: auth.data.user.id, status, history: history.data as Handoff[] };
  }, []);
  const { data, error, loading, reload } = useResource(load, null);
  if (error) return <LoadFailure message={error} retry={reload} />;
  if (!data) return <p>Cargando caja…</p>;
  const blocked = Boolean(data.status.active || data.status.handoff);
  const save = async () => {
    if (busy) return; setBusy(true); setMessage('');
    try {
      if (hasDrawerRequest(localStorage, data.actor, 'rate')) await recoverDrawerRequest(supabase, localStorage, data.actor, 'rate');
      else await drawerWrite(supabase, localStorage, data.actor, 'rate', { rate: Number(rate.replace(',', '.')) });
      setMessage('Tipo de cambio guardado. Los cajeros lo usarán automáticamente.'); setRate(''); await reload();
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };
  return <div className="space-y-6"><h1>Caja única</h1>
    <section className="border rounded-xl bg-white p-5 space-y-3"><h2>Tipo de cambio guardado</h2>
      <p>{data.status.rate ? `1 USD = ${data.status.rate} MXN` : 'El responsable debe definirlo antes de la primera apertura.'}</p>
      <p>Se conserva entre turnos. Cambia este valor solo cuando cambie la política del negocio; las ventas anteriores conservan su tipo de cambio.</p>
      {blocked && <p role="status">La caja está abierta o tiene una entrega pendiente. Termina ese proceso antes de cambiar el tipo de cambio.</p>}
      <form onSubmit={e => { e.preventDefault(); void save(); }} className="flex flex-wrap gap-3 items-end">
        <label>MXN por 1 USD<input aria-label="Tipo de cambio guardado MXN por USD" className="block border rounded p-3" inputMode="decimal" value={rate} disabled={busy || blocked} onChange={e => setRate(e.target.value)} /></label>
        <button className="border rounded p-3" disabled={busy || blocked || loading || !/^\d+(?:[.,]\d{1,4})?$/.test(rate) || Number(rate.replace(',','.'))<=0}>Guardar tipo de cambio</button>
        <button type="button" className="border rounded p-3" disabled={busy} onClick={()=>void save()}>Recuperar guardado pendiente</button>
      </form>{message && <p role="status">{message}</p>}
    </section>
    <section className="border rounded-xl bg-white p-5 overflow-auto"><h2>Últimas 50 entregas entre cajeros</h2>
      <p>El cajero saliente cuenta y entrega; el entrante confirma con su propia sesión. Se conservan ambos importes y cualquier diferencia.</p>
      <table><thead><tr>{['Fecha','Entrega','Recibe','Entregado MXN','Recibido MXN','Diferencia MXN','Estado / motivo'].map(label=><th className="p-3 text-left" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.history.map(h=><tr key={h.id}><td className="p-3">{new Date(h.created_at).toLocaleString('es-MX',{timeZone:'America/Matamoros'})}</td><td className="p-3">{h.from_name}</td><td className="p-3">{h.to_name}</td><td className="p-3">{h.delivered.toFixed(2)}</td><td className="p-3">{h.received?.toFixed(2)??'Pendiente'}</td><td className="p-3">{h.difference?.toFixed(2)??'—'}</td><td className="p-3">{h.accepted_at?'Aceptada':'Pendiente'} {h.note}</td></tr>)}</tbody></table>
      {!data.history.length&&<p>Todavía no hay entregas.</p>}
    </section>
  </div>;
}
