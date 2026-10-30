'use client';

import { useCallback, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { errorMessage, type ProductRow } from '@/lib/pos-types';
import { loadRegisterShortcuts, readRegisterShortcutsRequest, recoverRegisterShortcuts, saveRegisterShortcuts, type RegisterShortcuts } from '@/lib/register-shortcuts';
import LoadFailure from '@/app/LoadFailure';
import './favoritos.css';

interface FavoritesData { actor: string; products: ProductRow[]; config: RegisterShortcuts; pending: boolean }

function FavoritesEditor({ data, reload, confirmed, onSaved }: { data: FavoritesData; reload: () => Promise<void>; confirmed: string; onSaved: (message: string) => void }) {
  const [chosen, setChosen] = useState(data.config.product_ids), [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(data.pending), [message, setMessage] = useState('');
  const products = new Map(data.products.map(product => [product.id, product]));
  const move = (index: number, direction: number) => {
    const next = [...chosen]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; setChosen(next);
  };
  const save = async (recover = false) => {
    if (busy) return;
    setBusy(true); setMessage(''); onSaved('');
    try {
      if (recover) await recoverRegisterShortcuts(supabase, localStorage, data.actor);
      else await saveRegisterShortcuts(supabase, localStorage, data.actor, { product_ids: chosen, revision: data.config.revision });
      setPending(false); onSaved('Favoritos guardados. Se mostrarán en caja al actualizar el menú.');
      await reload();
    } catch (error) {
      setMessage(errorMessage(error));
      try { setPending(Boolean(readRegisterShortcutsRequest(localStorage, data.actor))); } catch { setPending(true); }
    } finally { setBusy(false); }
  };
  const disabled = busy || pending;
  return <div className="workspace-favorites space-y-6"><div><h1>Favoritos de caja</h1><p>Elige hasta 8 productos. Todos los cajeros verán esta misma selección, en el orden que guardes.</p></div>
    <section className="bg-white border p-5"><h2>Orden en caja · {chosen.length}/8</h2>
      <p>Una selección de 6 a 8 productos facilita los pedidos habituales. Puedes empezar con menos.</p>
      {!chosen.length && <p>No hay favoritos elegidos. El menú completo seguirá disponible.</p>}
      <ol className="workspace-favorites-selected">{chosen.map((id, index) => {
        const product = products.get(id);
        return <li key={id}><span><strong>{index + 1}. {product?.name ?? 'Producto no disponible'}</strong>{!product?.is_active && <small>Inactivo: quítalo antes de guardar.</small>}</span>
          <button type="button" aria-label={`Subir ${product?.name ?? 'producto'}`} disabled={disabled || index === 0} onClick={() => move(index, -1)}><ArrowUp size={19}/></button>
          <button type="button" aria-label={`Bajar ${product?.name ?? 'producto'}`} disabled={disabled || index === chosen.length - 1} onClick={() => move(index, 1)}><ArrowDown size={19}/></button>
          <button type="button" aria-label={`Quitar ${product?.name ?? 'producto'}`} disabled={disabled} onClick={() => setChosen(chosen.filter(value => value !== id))}><X size={19}/></button></li>;
      })}</ol>
      {confirmed && <p role="status" className="rounded-xl border border-blue-100 bg-blue-50 p-4 mb-4">{confirmed}</p>}
      <div className="workspace-favorites-actions"><button type="button" className="bg-blue-600 text-white px-5" disabled={disabled || chosen.some(id => !products.get(id)?.is_active)} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar favoritos'}</button>
        <button type="button" className="border px-4" disabled={busy} onClick={() => void reload()}>Actualizar selección guardada</button></div>
      {pending && <div role="alert" className="p-4 mt-4"><p>El guardado no está confirmado. Conservamos la misma solicitud para recuperarla sin reemplazarla.</p><button type="button" className="border px-4" disabled={busy} onClick={() => void save(true)}>Recuperar guardado pendiente</button></div>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className="bg-white border p-5"><h2>Productos activos</h2><label>Buscar producto<input className="block w-full mt-2" aria-label="Buscar producto favorito" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)}/></label>
      <div className="workspace-favorites-catalog">{data.products.filter(product => product.is_active && product.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))).map(product => <button type="button" key={product.id} aria-pressed={chosen.includes(product.id)} disabled={disabled || (!chosen.includes(product.id) && chosen.length >= 8)} onClick={() => setChosen(chosen.includes(product.id) ? chosen.filter(id => id !== product.id) : [...chosen, product.id])}><span>{product.name}</span><small>{chosen.includes(product.id) ? 'Elegido' : `$${Number(product.price).toFixed(2)}`}</small></button>)}</div>
    </section>
  </div>;
}

export default function FavoritesPage() {
  const [confirmed, setConfirmed] = useState('');
  const load = useCallback(async (signal: AbortSignal): Promise<FavoritesData> => {
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) throw new Error('Inicia sesión.');
    const [config, products] = await Promise.all([loadRegisterShortcuts(supabase, signal), supabase.from('products').select('*').order('name').abortSignal(signal)]);
    if (products.error) throw products.error;
    return { actor: auth.data.user.id, config, products: (products.data ?? []) as ProductRow[], pending: Boolean(readRegisterShortcutsRequest(localStorage, auth.data.user.id)) };
  }, []);
  const { data, error, loading, reload } = useResource(load, null);
  return error ? <LoadFailure message={error} retry={reload}/> : !data || loading ? <p>Cargando favoritos…</p>
    : <FavoritesEditor key={`${data.actor}:${data.config.revision}`} data={data} reload={reload} confirmed={confirmed} onSaved={setConfirmed}/>;
}
