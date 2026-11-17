'use client';

import { useRef, useState } from 'react';
import { parseSmoothiesForm } from '@/lib/smoothies-import';

type PendingImport = {
  raw: {extras: Array<{id:string;kind?:'milk'|'add-on'}>};
  data: ReturnType<typeof parseSmoothiesForm>;
};

export default function SmoothiesImport({ onImported, disabled }: { onImported: () => void; disabled: boolean }) {
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  async function read(file: File) {
    if (lock.current || disabled) return;
    setPending(null);
    setMessage('');
    lock.current = true;
    setBusy(true);
    try {
      if (file.size > 24_000_000) throw Error('El archivo es demasiado grande.');
      const raw = JSON.parse(await file.text());
      setPending({raw,data:parseSmoothiesForm(raw)});
      setFailed(false);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof SyntaxError ? 'Selecciona el JSON descargado desde el formulario.' : (error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function apply() {
    if (lock.current || !pending || disabled) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch('/api/smoothies-import', {method:'POST', headers:{
        'Content-Type':'application/json', 'X-Pos-Import':'1',
      },body:JSON.stringify(pending.raw),signal:AbortSignal.timeout(60_000)});
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'No se pudo importar.');
      setPending(null);
      setFailed(false);
      setMessage(result.unchanged ? 'Este archivo ya se importó.' : 'Formulario importado. Revisa los insumos en Conteo de apertura.');
      onImported();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error && error.name !== 'TimeoutError' && !(error instanceof TypeError)
        ? error.message : 'No se confirmó la importación. Puedes intentar de nuevo con el mismo archivo.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <details className="admin-recovery">
    <summary>Importar formulario de smoothies</summary>
    <label className="admin-field">Archivo descargado del formulario
      <input type="file" accept=".json,application/json" disabled={busy || disabled} onChange={event => {
        const file=event.target.files?.[0];
        event.target.value='';
        if (file) void read(file);
      }}/></label>
    {pending && <div>
      <p>{pending.data.menu.length} productos · {pending.data.extras.length} extras · {pending.data.stock.length} insumos previstos</p>
      <details><summary>Ver productos y sus extras</summary>
        <ul>{pending.data.menu.map(p => <li key={p.id}>{p.displayName} · {'$' + p.price.toFixed(2)} · {
          pending.data.extras.filter(e=>e.productIds.includes(p.id)).map(e=>e.name).join(', ') || 'Sin extras'
        }</li>)}</ul>
      </details>
      {!!pending.data.extras.length && <details><summary>Revisar tipos de extras</summary>
        {pending.data.extras.map(extra => <label key={extra.id} className="admin-field">{extra.name}
          <select disabled={busy || disabled} value={extra.phase==='Leche alternativa'?'milk':'add-on'} onChange={event => {
            const kind = event.target.value === 'milk' ? 'milk' : 'add-on';
            const raw = {...pending.raw, extras:pending.raw.extras.map(row =>
              row.id.toLowerCase() === extra.id ? {...row,kind} as const : row)};
            setPending({raw,data:parseSmoothiesForm(raw)});
          }}>
            <option value="milk">Cambio de leche (una opción)</option>
            <option value="add-on">Extra que se puede combinar</option>
          </select>
        </label>)}
      </details>}
      <p>Usa el formulario completo. Los productos y extras de una importación anterior que ya no aparezcan quedarán inactivos.</p>
      <p>Si reemplazas el formulario, también se actualizarán las asignaciones de los extras que trae.</p>
      <button type="button" disabled={busy || disabled} onClick={() => void apply()}>{busy ? 'Importando…' : 'Confirmar importación'}</button>
    </div>}
    {message && <p role={failed?'alert':'status'}>{message}</p>}
  </details>;
}
