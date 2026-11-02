'use client';

import { useCallback, useState } from 'react';
import { ArrowRight, Pencil, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { drawerWrite, hasDrawerRequest, loadDrawerStatus, recoverDrawerRequest } from '@/lib/drawer';
import { errorMessage } from '@/lib/pos-types';
import LoadFailure from '@/app/LoadFailure';
import { SettingsGroup, SettingsRow, SettingsNotice } from '../Settings';
import ManagerRecovery from './ManagerRecovery';

interface Handoff { id: string; from_name: string; to_name: string; delivered: number; received: number | null; difference: number | null; note: string; created_at: string; accepted_at: string | null }
const money = (value: number) => `$${value.toFixed(2)}`;
export default function DrawerAdmin() {
  const [rate, setRate] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [editing, setEditing] = useState(false);
  const [pendingRate, setPendingRate] = useState(false), [storageError, setStorageError] = useState(false);
  const load = useCallback(async (signal: AbortSignal) => {
    const auth = await supabase.auth.getUser(); if (!auth.data.user || auth.error) throw new Error('Inicia sesión.');
    const [status, history] = await Promise.all([loadDrawerStatus(supabase, signal), supabase.rpc('pos_drawer_history').abortSignal(signal)]);
    if (history.error) throw history.error;
    if (!Array.isArray(history.data)) throw new Error('No se pudieron cargar las entregas.');
    let activeRate: number | null = null;
    if (status.active) {
      const shift = await supabase.from('cash_registers').select('exchange_rate').eq('id', status.active.id).abortSignal(signal).single();
      if (shift.error) throw shift.error;
      activeRate = Number(shift.data.exchange_rate);
      if (!Number.isFinite(activeRate) || activeRate <= 0) throw new Error('No se pudo cargar el tipo de cambio del turno.');
    }
    let pending = true, unreadable = false;
    try { pending = hasDrawerRequest(localStorage, auth.data.user.id, 'rate'); } catch { unreadable = true; }
    return { actor: auth.data.user.id, status, activeRate, history: history.data as Handoff[], pending, unreadable };
  }, []);
  const apply = useCallback((data: Awaited<ReturnType<typeof load>> | null) => {
    if (!data) return;
    setRate(data.status.rate === null ? '' : String(data.status.rate));
    setPendingRate(data.pending); setStorageError(data.unreadable);
  }, []);
  const { data, error, loading, reload } = useResource(load, null, apply);
  const checkPending = (actor: string) => {
    try { setPendingRate(hasDrawerRequest(localStorage, actor, 'rate')); setStorageError(false); }
    catch { setPendingRate(true); setStorageError(true); }
  };
  const save = async (recover = false) => {
    if (busy || !data) return;
    setBusy(true); setMessage('');
    try {
      const pending = hasDrawerRequest(localStorage, data.actor, 'rate');
      if (recover) {
        if (!pending) throw new Error('No hay un cambio pendiente.');
        await recoverDrawerRequest(supabase, localStorage, data.actor, 'rate');
      } else {
        if (pending) throw new Error('Revisa el cambio pendiente antes de guardar otro.');
        await drawerWrite(supabase, localStorage, data.actor, 'rate', { rate: Number(rate.replace(',', '.')) });
      }
      setMessage('Tipo de cambio guardado.'); setEditing(false); await reload();
    } catch (error) { setMessage(errorMessage(error)); checkPending(data.actor); }
    finally { setBusy(false); }
  };
  if (error) return <LoadFailure message={error} retry={reload} />;
  if (!data) return <p role="status">Cargando caja…</p>;
  const blocked = Boolean(data.status.active || data.status.handoff);
  const differentRate = data.activeRate !== null && data.status.rate !== data.activeRate;
  return <div className="settings-page">
    <div className="settings-page-heading"><h1>Caja</h1><button type="button" className="settings-button" disabled={busy || loading} onClick={() => void reload()}><RefreshCw size={18} aria-hidden="true"/>Actualizar</button></div>
    {message && <SettingsNotice>{message}</SettingsNotice>}
    <SettingsGroup title="Tipo de cambio">
      <SettingsRow label={differentRate ? "Próxima apertura" : "Dólar estadounidense"} detail={differentRate ? 'Se aplica al volver a abrir caja.' : undefined}>
        <span className="settings-value">{data.status.rate ? `1 USD = ${data.status.rate} MXN` : 'Sin definir'}</span>
        <button type="button" aria-label="Editar tipo de cambio" disabled={busy || loading || pendingRate} onClick={() => setEditing(!editing)}><Pencil size={18} aria-hidden="true"/>{editing ? 'Cancelar' : 'Editar'}</button>
      </SettingsRow>
      {differentRate && <SettingsRow label="Turno actual"><span className="settings-value">1 USD = {data.activeRate} MXN</span></SettingsRow>}
      {editing && <form className="settings-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="settings-rate-editor"><div className="settings-rate-source"><strong>1</strong><span>USD</span></div><ArrowRight size={20} aria-hidden="true"/><label className="settings-rate-target"><input aria-label="Tipo de cambio guardado MXN por USD" inputMode="decimal" value={rate} disabled={busy || blocked || pendingRate} onChange={event => setRate(event.target.value)}/><span>MXN</span></label><button className="is-primary" disabled={busy || blocked || loading || pendingRate || !/^\d+(?:[.,]\d{1,4})?$/.test(rate) || Number(rate.replace(',','.')) <= 0}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
        {blocked && <p className="settings-help">Cierra la caja y termina cualquier entrega para editar este valor.</p>}
      </form>}
      {pendingRate && <div className="settings-editor"><SettingsNotice error={storageError}>{storageError ? 'No se pudo leer el cambio pendiente. Vuelve a abrir esta pantalla.' : 'Hay un cambio de tipo de cambio sin confirmar.'}</SettingsNotice><div><button type="button" disabled={busy} onClick={() => void save(true)}>Revisar cambio pendiente</button></div></div>}
    </SettingsGroup>
    <ManagerRecovery actor={data.actor} status={data.status} reload={reload}/>
    <SettingsGroup title="Entregas entre cajeros">
      {!data.history.length ? <p className="settings-empty">Sin entregas todavía.</p> : <div className="settings-table-scroll"><table className="settings-table"><thead><tr>{['Fecha','Entrega','Recibe','Entregado','Recibido','Diferencia','Estado'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{data.history.map(h => <tr key={h.id}><td>{new Date(h.created_at).toLocaleString('es-MX', {timeZone:'America/Matamoros'})}</td><td>{h.from_name}</td><td>{h.to_name}</td><td>{money(h.delivered)}</td><td>{h.received === null ? 'Pendiente' : money(h.received)}</td><td>{h.difference === null ? '—' : money(h.difference)}</td><td>{h.accepted_at ? 'Recibida' : 'Pendiente'}{h.note && <details><summary>Ver nota</summary><p>{h.note}</p></details>}</td></tr>)}</tbody></table></div>}
    </SettingsGroup>
  </div>;
}
