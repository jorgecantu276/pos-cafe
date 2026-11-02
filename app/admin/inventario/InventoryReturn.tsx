'use client';

import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { withDeadline } from '@/lib/request-deadline';
import { errorMessage } from '@/lib/pos-types';
import { readInventoryRequest, saveInventoryRequest, type InventoryRequest, type InventoryReturnLine } from '@/lib/inventory';
import './inventory.css';

export default function InventoryReturn({ orderId }: { orderId: string }) {
  const load = useCallback(async (signal: AbortSignal) => {
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Inicia sesión para devolver productos.');
    const { data, error } = await supabase.rpc('pos_inventory_sale_lines', { p_order: orderId }).abortSignal(signal);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('No se recibieron los productos para devolución.');
    return { actor: user.id, lines: data as InventoryReturnLine[], pending: readInventoryRequest(localStorage, user.id) };
  }, [orderId]);
  const { data, loading, error, reload, setData } = useResource(load, { actor: '', lines: [] as InventoryReturnLine[], pending: null as InventoryRequest | null });
  const [quantities, setQuantities] = useState<Record<number, string>>({}), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const inFlight = useRef(false);
  const save = async (recover = false) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(''); setNotice('');
    try {
      const { data: { user }, error } = await withDeadline(() => supabase.auth.getUser());
      if (error || user?.id !== data.actor) throw new Error('La sesión cambió. Actualiza la página.');
      const existing = readInventoryRequest(localStorage, data.actor);
      if (existing && !recover) {
        setData(current => ({ ...current, pending: existing }));
        throw new Error('Hay un cambio pendiente. Revísalo antes de guardar la devolución.');
      }
      if (recover && !existing) throw new Error('No hay una devolución pendiente.');
      const lines = data.lines.filter(l => Number(quantities[l.id]) > 0).map(l => ({ id: l.id, quantity: Number(quantities[l.id]) }));
      if (!existing && (!confirmed || !lines.length || lines.some(l => !Number.isInteger(l.quantity)
        || l.quantity > data.lines.find(v => v.id === l.id)!.sold - data.lines.find(v => v.id === l.id)!.returned))) throw new Error('Revisa las cantidades y confirma que pueden volver a venderse.');
      const pending: InventoryRequest = existing || { actor: data.actor, request: crypto.randomUUID(), rpc: 'pos_inventory_return', args: { p_order: orderId, p_lines: lines } };
      await saveInventoryRequest(supabase, localStorage, pending);
      if (pending.rpc === 'pos_inventory_return' && 'p_order' in pending.args && pending.args.p_order === orderId) { setQuantities({}); setConfirmed(false); }
      setNotice('Inventario actualizado.'); await reload();
    } catch (error) {
      setFailure(errorMessage(error));
      try { setData(current => ({ ...current, pending: readInventoryRequest(localStorage, data.actor) })); }
      catch { setFailure('No se pudo leer el cambio pendiente. No guardes otro todavía.'); }
    } finally { inFlight.current = false; setBusy(false); }
  };
  if (error) return <div className="inventory-return"><p role="alert">{error}</p><button onClick={() => void reload()}>Reintentar inventario</button></div>;
  if (loading && !data.actor) return <p>Cargando productos para devolución…</p>;
  if (!data.lines.length && !data.pending) return <p className="text-sm text-slate-600">Esta venta no tiene descuentos de existencias registrados.</p>;
  return <section className="inventory-return" aria-label="Devolver a inventario"><h3>Devolver a inventario</h3>
    <p>Devuelve solo productos que puedan venderse otra vez. No reembolsa el pago.</p>
    {data.pending ? <div><p>Hay un cambio sin confirmar.</p><button disabled={busy || loading} onClick={() => void save(true)}>Revisar cambio pendiente</button></div>
      : <form onSubmit={e => { e.preventDefault(); void save(); }}>
        {data.lines.filter(l => l.returned < l.sold).map(l => <label key={l.id}>{l.product_name} · {l.sold - l.returned} {l.unit} por devolver<input aria-label={`Devolver ${l.product_name}`} type="number" min="0" max={l.sold - l.returned} step="1" inputMode="numeric" value={quantities[l.id] ?? ''} disabled={busy || loading} onChange={e => setQuantities(q => ({ ...q, [l.id]: e.target.value }))} /></label>)}
        {data.lines.every(l => l.returned >= l.sold) ? <p>Ya se devolvieron todas las piezas registradas.</p> : <><label><span><input type="checkbox" style={{ width: 'auto' }} checked={confirmed} disabled={busy || loading} onChange={e => setConfirmed(e.target.checked)} /> Estas piezas están en condiciones de volver a venderse.</span></label><button disabled={busy || loading || !confirmed} type="submit">Guardar devolución</button></>}
      </form>}
    {failure && <p role="alert">{failure}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
