'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useResource } from '@/lib/use-resource';
import { errorMessage } from '@/lib/pos-types';
import AdminDialog from '../AdminDialog';

type OpeningRow = { id: string; name: string; unit: string; quantity: number | null; counted: number | null; revision: number };
const emptyPlan: OpeningRow[] = [];
const formatQuantity = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 });

export default function OpeningCount({ importRevision }: { importRevision: number }) {
  const load = useCallback(async (signal: AbortSignal) => {
    const { data, error } = await supabase.rpc('pos_smoothies_opening_plan').abortSignal(signal);
    if (error || !Array.isArray(data)) throw Error('No se pudieron cargar los insumos.');
    return data as OpeningRow[];
  }, []);
  const { data: plan, loading, error, reload } = useResource(load, emptyPlan);
  const [editing, setEditing] = useState<OpeningRow | null>(null);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const observedRevision = useRef(importRevision);

  useEffect(() => {
    if (observedRevision.current !== importRevision) {
      observedRevision.current = importRevision;
      void reload();
    }
  }, [importRevision, reload]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current || !editing) return;
    const value = amount.trim().replace(',', '.');
    if (!/^\d{1,7}(?:\.\d{1,3})?$/.test(value)) {
      setMessage('Escribe una cantidad con hasta tres decimales. Si tienes cero, escribe 0.');
      return;
    }
    saving.current = true;
    setBusy(true);
    setMessage('');
    try {
      const { error: saveError } = await supabase.rpc('pos_count_smoothies_opening', {
        p_id: editing.id, p_unit: editing.unit, p_revision: editing.revision, p_quantity: Number(value),
      }).abortSignal(AbortSignal.timeout(10_000));
      if (saveError) throw saveError;
      setSaved(`Conteo de ${editing.name} guardado.`);
      setEditing(null);
      await reload();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const counted = plan.filter(row => row.counted !== null).length;
  return <details className="admin-recovery">
    <summary>Conteo de apertura{plan.length > 0 && ` · ${counted} de ${plan.length} insumos`}</summary>
    <p>Registra lo que tengas justo antes de abrir. Las cantidades previstas aparecen como referencia.</p>
    {error && <p role="alert">{error} <button type="button" onClick={() => void reload()}>Reintentar</button></p>}
    {loading && <p role="status">Cargando insumos…</p>}
    {!error && !loading && plan.length === 0 && <p>Importa un formulario con insumos para empezar el conteo.</p>}
    {saved && <p role="status">{saved}</p>}
    {!error && plan.map(row => <div className="catalog-row" key={row.id}>
      <div className="catalog-copy"><h2>{row.name}</h2><p>{row.quantity === null ? `Previsto sin definir · ${row.unit}` : `Previsto: ${formatQuantity.format(row.quantity)} ${row.unit}`}</p></div>
      <strong>{row.counted === null ? 'Pendiente' : `${formatQuantity.format(row.counted)} ${row.unit}`}</strong>
      <button type="button" className="admin-secondary-button" disabled={busy || loading} aria-label={`${row.counted === null ? 'Contar' : 'Corregir'} ${row.name}`}
        onClick={() => { setEditing(row); setAmount(row.counted === null ? '' : String(row.counted)); setMessage(''); setSaved(''); }}>
        {row.counted === null ? 'Contar' : 'Corregir'}
      </button>
    </div>)}
    {editing && <AdminDialog title={`Conteo de ${editing.name}`} busy={busy} onClose={() => setEditing(null)} footer={<>
      <button type="button" className="admin-secondary-button" disabled={busy} onClick={() => { setEditing(null); void reload(); }}>Cerrar</button>
      <button type="submit" form="opening-count" className="admin-primary-button" disabled={busy}>{busy ? 'Guardando…' : 'Guardar conteo'}</button>
    </>}>
      <form id="opening-count" onSubmit={save}>
        <label className="admin-field">Cantidad contada ({editing.unit})
          <input data-dialog-autofocus required inputMode="decimal" maxLength={11} disabled={busy} value={amount} onChange={event => setAmount(event.target.value)} />
        </label>
        {message && <p role="alert">{message}</p>}
      </form>
    </AdminDialog>}
  </details>;
}
