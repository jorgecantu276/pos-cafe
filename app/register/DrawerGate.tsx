'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { drawerWrite, hasDrawerRequest, recoverDrawerRequest, type DrawerStatus } from '@/lib/drawer';
import { errorMessage } from '@/lib/pos-types';
import { WorkspaceDialog } from './WorkspaceRegister';

export default function DrawerGate({ client, status, actor, isAdmin, reload, logout }: { client: Pick<SupabaseClient,'rpc'>; status: DrawerStatus; actor: string; isAdmin: boolean; reload: () => Promise<unknown>; logout: () => void }) {
  const [mxn, setMXN] = useState(''), [usd, setUSD] = useState(''), [note, setNote] = useState('');
  const [to, setTo] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const handoff = status.handoff, canAccept = handoff?.to_id === actor;
  const counted = Math.round((Number(mxn || 0) + Number(usd || 0) * (handoff?.rate ?? 0)) * 100) / 100;
  const difference = handoff ? Math.round((counted - handoff.delivered) * 100) / 100 : 0;
  const action = async (operation: 'accept' | 'reassign') => {
    setBusy(true); setError('');
    try {
      if (hasDrawerRequest(localStorage, actor, operation)) await recoverDrawerRequest(client, localStorage, actor, operation);
      else await drawerWrite(client, localStorage, actor, operation, operation === 'accept' ? { handoff: handoff!.id, counted, note: note.trim() } : { handoff: handoff!.id, to, reason: note.trim() });
      await reload();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <WorkspaceDialog title={handoff ? 'Entrega de caja pendiente' : status.active ? 'Caja ocupada' : 'Configurar caja'} onClose={logout} busy={busy}>
    <div className="workspace-dialog-content">
      {isAdmin && <a className="workspace-admin-gateway" href="/admin/caja">Administrar caja y tipo de cambio</a>}
      {isAdmin && <a className="workspace-admin-gateway" href="/admin/impresion">Revisar impresión pendiente</a>}
      {handoff ? <>
        <p>{handoff.from_name} entregó ${handoff.delivered.toFixed(2)} MXN para {handoff.to_name}.</p>
        {canAccept ? <>
          <p>Cuenta el dinero recibido antes de aceptar. 1 USD = {handoff.rate} MXN. La aceptación abre tu turno con el efectivo que confirmes.</p>
          <label>Efectivo recibido MXN<input aria-label="Efectivo recibido MXN" inputMode="decimal" value={mxn} disabled={busy} onChange={e => setMXN(e.target.value)} /></label>
          <label>Dólares recibidos<input aria-label="Dólares recibidos" inputMode="decimal" value={usd} disabled={busy} onChange={e => setUSD(e.target.value)} /></label>
          <p>Total recibido: ${Number.isFinite(counted) ? counted.toFixed(2) : '—'} MXN. Diferencia: ${Number.isFinite(difference) ? difference.toFixed(2) : '—'}.</p>
          {difference !== 0 && <p role="alert">La diferencia quedará registrada con ambos cajeros. Escribe el motivo antes de aceptar.</p>}
          <label>Motivo de diferencia (si existe)<input aria-label="Motivo de diferencia" maxLength={300} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
          <button className="workspace-primary" disabled={busy || !mxn.trim() || !Number.isFinite(counted) || Number(mxn)<0 || Number(usd)<0 || (difference !== 0 && note.trim().length < 3)} onClick={() => void action('accept')}>Confirmar efectivo y recibir caja</button>
          <button disabled={busy} onClick={() => void recoverDrawerRequest(client,localStorage,actor,'accept').then(()=>reload()).catch(error=>setError(errorMessage(error)))}>Recuperar aceptación pendiente</button>
        </> : <p>Debe iniciar sesión {handoff.to_name} para contar y recibir la caja. No se puede abrir otro turno mientras la entrega esté pendiente.</p>}
        {isAdmin && !canAccept && <><label>Reasignar al cajero que recibirá<select value={to} onChange={e => setTo(e.target.value)} disabled={busy}><option value="">Selecciona</option><option value={actor}>Yo recibiré la caja</option>{status.cashiers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Motivo de reasignación<input maxLength={300} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
          <button disabled={busy || !to || note.trim().length<3} onClick={() => void action('reassign')}>Reasignar entrega</button></>}
      </> : status.active ? <p>{status.active.cashier_name} tiene la única caja abierta. Ese cajero debe entregar o cerrar su turno antes de abrir otro.</p> : <p>El responsable debe guardar el tipo de cambio una vez en Administración → Caja. Los cajeros usarán ese valor sin escribirlo en cada turno.</p>}
      {error && <p role="alert">{error}</p>}
    </div><footer><button disabled={busy} onClick={() => void reload()}>Actualizar estado</button><button disabled={busy} onClick={logout}>Cambiar usuario</button></footer>
  </WorkspaceDialog>;
}
