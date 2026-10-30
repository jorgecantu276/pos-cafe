'use client';

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { withDeadline } from '@/lib/request-deadline';
import { errorMessage } from '@/lib/pos-types';
import LoadFailure from '@/app/LoadFailure';
import { readInventoryRequest, saveInventoryRequest,
  type InventoryChange, type InventoryItem, type InventoryMovement, type InventoryRequest } from '@/lib/inventory';
import { InventoryWorkspace } from './InventoryWorkspace';
import './inventory.css';

interface InventoryData { actor: string; items: InventoryItem[]; history: InventoryMovement[]; pending: InventoryRequest | null }
const initial: InventoryData = { actor: '', items: [], history: [], pending: null };
export default function InventoryPage() {
  const [before, setBefore] = useState<number | null>(null);
  const load = useCallback(async (signal: AbortSignal): Promise<InventoryData> => {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Inicia sesión para consultar el inventario.');
    const [catalog, history] = await Promise.all([
      supabase.rpc('pos_inventory_catalog').abortSignal(signal),
      supabase.rpc('pos_inventory_history', { p_before: before }).abortSignal(signal),
    ]);
    if (catalog.error || history.error) throw catalog.error || history.error;
    if (!Array.isArray(catalog.data) || !Array.isArray(history.data)) throw new Error('No se recibió el inventario.');
    return { actor: user.id, items: catalog.data, history: history.data, pending: readInventoryRequest(localStorage, user.id) };
  }, [before]);
  const { data, loading, error, reload, setData } = useResource(load, initial);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [failure, setFailure] = useState('');
  const inFlight = useRef(false);
  const save = async (changes?: InventoryChange[]) => {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setFailure(''); setNotice('');
    try {
      const { data: { user }, error } = await withDeadline(() => supabase.auth.getUser());
      if (error || user?.id !== data.actor) throw new Error('La sesión cambió. Actualiza la página.');
      const pending = readInventoryRequest(localStorage, data.actor) || (changes ? {
        actor: data.actor, request: crypto.randomUUID(), rpc: 'pos_inventory_write' as const, args: { p_changes: changes },
      } : null);
      if (!pending) throw new Error('No hay una operación pendiente.');
      await saveInventoryRequest(supabase, localStorage, pending);
      setNotice('Inventario actualizado.'); await reload(); return true;
    } catch (error) {
      setFailure(errorMessage(error));
      try { setData(current => ({ ...current, pending: readInventoryRequest(localStorage, data.actor) })); }
      catch { setFailure('No se pudo leer la operación pendiente. Conserva esta ventana y solicita revisión.'); }
      return false;
    } finally { inFlight.current = false; setBusy(false); }
  };
  if (error) return <LoadFailure message={error} retry={reload} />;
  if (!data.actor) return <p role="status">Cargando inventario…</p>;
  return <div className="inventory-page">
    {data.pending && <div className="inventory-recovery" role="status"><strong>Hay una operación pendiente de confirmar.</strong><p>Recupérala antes de hacer otro cambio.</p><button disabled={busy || loading} onClick={() => void save()}>Recuperar operación</button></div>}
    {failure && <p className="inventory-error" role="alert">{failure}</p>}
    {notice && <p role="status">{notice}</p>}
    <InventoryWorkspace items={data.items} history={data.history} disabled={busy || loading || Boolean(data.pending)} onSave={save}
      onRefresh={() => void reload()} before={before} onHistoryPage={setBefore} />
  </div>;
}

