'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { withDeadline } from '@/lib/request-deadline';
import { errorMessage } from '@/lib/pos-types';
import LoadFailure from '@/app/LoadFailure';
import { announceCatalogChange } from '@/lib/catalog-management';
import { SettingsGroup, SettingsRow } from '../Settings';
import { readInventoryRequest, saveInventoryRequest,
  type InventoryChange, type InventoryItem, type InventoryMovement, type InventoryRequest } from '@/lib/inventory';
import { InventoryWorkspace } from './InventoryWorkspace';
import './inventory.css';

interface InventoryData { actor: string; items: InventoryItem[]; history: InventoryMovement[]; pending: InventoryRequest | null; state: { enabled: boolean; revision: number } }
const initial: InventoryData = { actor: '', items: [], history: [], pending: null, state: { enabled: false, revision: 0 } };
export default function InventoryPage() {
  const router = useRouter();
  const [before, setBefore] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const load = useCallback(async (signal: AbortSignal): Promise<InventoryData> => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Inicia sesión para consultar el inventario.');
    const [catalog, history, state] = await Promise.all([
      supabase.rpc('pos_inventory_catalog').abortSignal(signal),
      supabase.rpc('pos_inventory_history', { p_before: before }).abortSignal(signal),
      supabase.rpc('pos_inventory_state').abortSignal(signal),
    ]);
    if (catalog.error || history.error || state.error) throw catalog.error || history.error || state.error;
    if (!Array.isArray(catalog.data) || !Array.isArray(history.data)) throw new Error('No se recibió el inventario.');
    if (typeof state.data?.enabled !== 'boolean' || !Number.isInteger(state.data.revision)) throw new Error('No se recibió el estado de activación.');
    return { actor: user.id, items: catalog.data, history: history.data, pending: readInventoryRequest(localStorage, user.id),state:state.data };
  }, [before]);
  const { data, loading, error, reload, setData } = useResource(load, initial);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [failure, setFailure] = useState('');
  const inFlight = useRef(false);
  const activation = useRef<HTMLDetailsElement>(null);
  const save = async (changes?: InventoryChange[], toggle?: boolean) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setFailure(''); setNotice('');
    try {
      const { data: { user }, error } = await withDeadline(() => supabase.auth.getUser());
      if (error || user?.id !== data.actor) throw new Error('La sesión cambió. Actualiza la página.');
      const existing = readInventoryRequest(localStorage, data.actor);
      if (existing && (changes !== undefined || toggle !== undefined)) {
        setData(current => ({ ...current, pending: existing }));
        throw new Error('Hay un cambio pendiente. Revísalo antes de guardar otro.');
      }
      const pending = existing || (toggle !== undefined ? {
        actor:data.actor,request:crypto.randomUUID(),rpc:'pos_inventory_set_enabled' as const,args:{p_enabled:toggle,p_revision:data.state.revision},
      } : changes ? {
        actor: data.actor, request: crypto.randomUUID(), rpc: 'pos_inventory_write' as const, args: { p_changes: changes },
      } : null);
      if (!pending) throw new Error('No hay una operación pendiente.');
      await saveInventoryRequest(supabase, localStorage, pending);
      if (pending.rpc === 'pos_inventory_set_enabled') {
        if (activation.current) activation.current.open = false;
        router.refresh();
      }
      announceCatalogChange(); setConfirmed(false);
      setNotice('Inventario actualizado.'); await reload(); return true;
    } catch (error) {
      setFailure(errorMessage(error));
      try { setData(current => ({ ...current, pending: readInventoryRequest(localStorage, data.actor) })); }
      catch { setFailure('No se pudo leer el cambio pendiente. No guardes otro todavía.'); }
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  };
  if (error) return <LoadFailure message={error} retry={reload} />;
  if (!data.actor) return <p role="status">Cargando inventario…</p>;
  return <div className="inventory-page settings-page"><h1>Inventario</h1>
    <SettingsGroup title="Control de existencias">
      <SettingsRow label="Inventario" detail={data.state.enabled ? 'Las ventas descuentan las existencias contadas.' : 'Las ventas no descuentan existencias.'}><span className={`settings-badge${data.state.enabled ? ' is-on' : ''}`}>{data.state.enabled ? 'Activado' : 'Desactivado'}</span></SettingsRow>
      <details ref={activation} className="settings-disclosure"><summary>{data.state.enabled ? 'Pausar inventario' : 'Activar inventario'}</summary><div>
        <p>{data.state.enabled ? 'Las ventas seguirán disponibles sin descontar productos.' : 'Al activarlo, vuelve a contar o importa las existencias actuales. Los conteos anteriores dejan de usarse.'}</p>
        <label className="settings-confirm"><input type="checkbox" checked={confirmed} disabled={busy || loading || Boolean(data.pending)} onChange={e=>setConfirmed(e.target.checked)}/>{data.state.enabled ? 'Pausar el descuento de existencias.' : 'Voy a registrar las existencias actuales.'}</label>
        <button className="is-primary" disabled={!confirmed || busy || loading || Boolean(data.pending)} onClick={()=>void save(undefined,!data.state.enabled)}>{data.state.enabled ? 'Pausar inventario' : 'Activar inventario'}</button>
      </div></details>
    </SettingsGroup>
    {data.pending && <div className="inventory-recovery" role="status"><strong>Hay un cambio sin confirmar.</strong><button disabled={busy || loading} onClick={() => void save()}>Revisar cambio pendiente</button></div>}
    {failure && <p className="inventory-error" role="alert">{failure}</p>}
    {notice && <p role="status">{notice}</p>}
    <InventoryWorkspace hideTitle items={data.items} history={data.history} disabled={busy || loading || Boolean(data.pending)} onSave={save}
      onRefresh={() => void reload()} before={before} onHistoryPage={setBefore} />
  </div>;
}
