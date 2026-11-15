'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { announceCatalogChange } from '@/lib/catalog-management';
import { errorMessage, isSmoothie, type ProductRow } from '@/lib/pos-types';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';

type Special = { product_id: string | null; revision: number };

export default function WeeklySpecial({ products, disabled }: { products: ProductRow[]; disabled: boolean }) {
  const load = useCallback(async (signal: AbortSignal): Promise<Special | null> => {
    const { data, error } = await supabase.rpc('pos_smoothies_special').abortSignal(signal);
    if (error) throw new Error(error.message);
    return data;
  }, []);
  const { data, loading, error, reload, setData } = useResource(load, null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const lock = useRef(false);
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.location.hash === '#especial-semanal' && panel.current) panel.current.open = true;
  }, []);
  const options = products.filter(product => product.is_active && isSmoothie(product));
  const stored = options.find(product => product.id === data?.product_id)?.id ?? '';
  const selected = choice ?? stored;

  async function save() {
    if (disabled || !data || lock.current || selected === stored) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    setSaveError('');
    try {
      const result = await supabase.rpc('pos_set_smoothies_special', {
        p_product: selected || null, p_revision: data.revision,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (result.error) throw new Error(result.error.message);
      setData(result.data);
      setChoice(null);
      setMessage(selected ? 'Especial guardado.' : 'Especial retirado.');
      announceCatalogChange();
    } catch (error) {
      setSaveError(`No se confirmó el cambio. ${errorMessage(error)}`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <details className="admin-recovery" id="especial-semanal" ref={panel}>
    <summary>Especial de la semana</summary>
    {loading ? <p>Cargando especial…</p> : error ? <p role="alert">No se pudo cargar el especial.</p> :
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="admin-field">Smoothie destacado
          <select value={selected} disabled={busy || disabled} onChange={event => { setChoice(event.target.value); setMessage(''); }}>
            <option value="">Sin especial</option>
            {options.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <button type="submit" disabled={busy || disabled || selected === stored || (!!selected && !options.some(product => product.id === selected))}>
          {busy ? 'Guardando…' : 'Guardar especial'}
        </button>
        {message && <p role="status">{message}</p>}
      </form>}
    {saveError && <p role="alert">{saveError}</p>}
    {(error || saveError) && <button type="button" disabled={busy || loading} onClick={() => { setChoice(null); setSaveError(''); void reload(); }}>Actualizar especial</button>}
  </details>;
}
