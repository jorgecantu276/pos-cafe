'use client';

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { drawerWrite, hasDrawerRequest, recoverDrawerRequest, type DrawerStatus } from '@/lib/drawer';
import { errorMessage } from '@/lib/pos-types';
import { WorkspaceDialog } from './WorkspaceRegister';
import { receivedCashMXN } from '@/lib/usd-cash';

export default function DrawerGate({ client, status, actor, isAdmin, reload, logout }: { client: Pick<SupabaseClient,'rpc'>; status: DrawerStatus; actor: string; isAdmin: boolean; reload: () => Promise<unknown>; logout: () => void }) {
  const [mxn, setMXN] = useState(''), [usd, setUSD] = useState(''), [note, setNote] = useState('');
  const [showUSD, setShowUSD] = useState(false);
  const [to, setTo] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const handoff = status.handoff, canAccept = handoff?.to_id === actor;
  const counted = receivedCashMXN(Number(mxn || 0), Number(usd || 0), handoff?.rate ?? 0);
  const difference = handoff ? Math.round((counted - handoff.delivered) * 100) / 100 : 0;
  const validCount = Boolean(mxn.trim()) && Number.isFinite(counted) && Number(mxn) >= 0 && Number(usd) >= 0
    && Math.round(Number(mxn) * 100) / 100 === Number(mxn) && Math.round(Number(usd || 0) * 100) / 100 === Number(usd || 0);
  const needsReason = validCount && difference !== 0;
  let pendingAccept = false;
  if (canAccept && typeof window !== 'undefined') {
    try { pendingAccept = hasDrawerRequest(localStorage, actor, 'accept'); }
    catch { /* The submit handler reports a storage error to the cashier. */ }
  }
  const action = async (operation: 'accept' | 'reassign') => {
    setBusy(true); setError('');
    try {
      if ((operation === 'accept' && pendingAccept) || hasDrawerRequest(localStorage, actor, operation)) await recoverDrawerRequest(client, localStorage, actor, operation);
      else await drawerWrite(client, localStorage, actor, operation, operation === 'accept' ? { handoff: handoff!.id, counted, note: needsReason ? note.trim() : '' } : { handoff: handoff!.id, to, reason: note.trim() });
      await reload();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  };
  return <WorkspaceDialog title={handoff ? 'Entrega de caja pendiente' : status.active ? 'Caja ocupada' : 'Configurar caja'} onClose={logout} busy={busy} className="workspace-drawer-gate">
    <div className="workspace-dialog-content">
      {isAdmin && <a className="workspace-admin-gateway" href="/admin/caja">Ajustes de caja</a>}
      {isAdmin && <a className="workspace-admin-gateway" href="/admin/impresion">Revisar impresión pendiente</a>}
      {handoff ? <>
        <p>{handoff.from_name} entregó ${handoff.delivered.toFixed(2)} MXN para {handoff.to_name}.</p>
        {canAccept ? <>
          <label>Efectivo recibido MXN<input aria-label="Efectivo recibido MXN" inputMode="decimal" value={mxn} disabled={busy || pendingAccept} onChange={e => setMXN(e.target.value)} /></label>
          {showUSD ? <><label>Dólares recibidos<input inputMode="decimal" value={usd} disabled={busy || pendingAccept} onChange={e => setUSD(e.target.value)} /></label><p>1 USD = {handoff.rate} MXN</p></> : <button type="button" disabled={busy || pendingAccept} onClick={() => setShowUSD(true)}>Agregar USD</button>}
          {validCount && <p role="status">Total recibido: ${counted.toFixed(2)} MXN{needsReason ? ` · Diferencia: ${difference.toFixed(2)} MXN` : ''}</p>}
          {needsReason && <label>Motivo de la diferencia<input aria-label="Motivo de diferencia" maxLength={300} value={note} disabled={busy || pendingAccept} onChange={e => setNote(e.target.value)} /></label>}
        </> : <p>Debe iniciar sesión {handoff.to_name} para recibir la caja. </p>}
        {isAdmin && !canAccept && <><label>Reasignar al cajero que recibirá<select value={to} onChange={e => setTo(e.target.value)} disabled={busy}><option value="">Selecciona</option><option value={actor}>Yo recibiré la caja</option>{status.cashiers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Motivo de reasignación<input maxLength={300} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
          <button disabled={busy || !to || note.trim().length<3} onClick={() => void action('reassign')}>Reasignar entrega</button></>}
      </> : status.active ? <p>{status.active.cashier_name} tiene la caja abierta. Debe cerrarla o entregarla para que puedas entrar.</p> : <p>Falta el tipo de cambio. Pide al responsable que lo guarde en Ajustes de caja.</p>}
      {error && <p role="alert">{error}</p>}
    </div><footer><button disabled={busy} onClick={() => void reload()}>Actualizar estado</button><button disabled={busy} onClick={logout}>Cambiar usuario</button>
      {canAccept && <button type="button" className="workspace-primary" disabled={busy || (!pendingAccept && (!validCount || (needsReason && note.trim().length < 3)))} onClick={() => void action('accept')}>{pendingAccept ? 'Comprobar recepción' : 'Recibir caja'}</button>}
    </footer>
  </WorkspaceDialog>;
}
