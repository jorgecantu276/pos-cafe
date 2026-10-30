'use client';

import { useEffect, useRef, useState } from 'react';
import { forgetSalePrint, pendingSalePrints, type PrintAudience, type SalePrintJob } from '@/lib/sale-printing';

interface Reply { mode: 'mock' | 'windows'; jobs: SalePrintJob[] }
const labels = { customer: 'Cliente · USB', barista: 'Barra · Bluetooth' };
export default function PrintDispatch({ checkoutKey, latestOrderId }: { checkoutKey: string; latestOrderId?: string }) {
  const [jobs, setJobs] = useState<SalePrintJob[]>([]), [error, setError] = useState(''), [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useRef<(orderId?: string, audience?: PrintAudience) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!checkoutKey) return;
    let active = true, running = false, pollNeeded = true;
    const controller = new AbortController();
    const request = async (orderId?: string, audience?: PrintAudience): Promise<Reply> => {
      const result = await fetch('/api/printing', { method: orderId ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Pos-Print': '1', ...(orderId ? { 'Content-Type': 'application/json' } : {}) },
        body: orderId ? JSON.stringify({ orderId, ...(audience ? { audience } : {}) }) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]) });
      const data = await result.json();
      if (!result.ok) {
        // A cancelled/withheld sale needs no automatic resend after refresh.
        if (orderId && result.status === 409) forgetSalePrint(localStorage, checkoutKey, orderId);
        throw new Error(data.error || 'No se pudo consultar la impresión.');
      }
      if (!Array.isArray(data.jobs) || !['mock', 'windows'].includes(data.mode)) throw new Error('Respuesta de impresión inválida.');
      return data;
    };
    const run = async (retryId?: string, audience?: PrintAudience) => {
      if (running || !active) return;
      running = true; setBusy(true);
      try {
        if (retryId) await request(retryId, audience);
        let result = await request();
        const pending = new Set(pendingSalePrints(localStorage, checkoutKey));
        for (const job of result.jobs) if (job.state === 'queued' || job.state === 'preparing') pending.add(job.orderId);
        // Independent orders can finish while another printer is slow.
        const outcomes = await Promise.allSettled([...pending].map(async orderId => {
          const sent = await request(orderId);
          if (sent.jobs.length === 2) forgetSalePrint(localStorage, checkoutKey, orderId);
        }));
        if (pending.size) result = await request();
        if (active) {
          setJobs(result.jobs); setMode(result.mode);
          const failure = outcomes.find(outcome => outcome.status === 'rejected');
          pollNeeded = Boolean(failure) || result.jobs.some(job => ['queued', 'preparing', 'submitting'].includes(job.state));
          setError(failure?.status === 'rejected' ? String(failure.reason?.message || 'Error de envío. Reintenta impresión.') : '');
        }
      } catch (failure) { pollNeeded = true; if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la impresión.'); }
      finally { running = false; if (active) setBusy(false); }
    };
    refresh.current = run;
    void run();
    const timer = setInterval(() => { if (pollNeeded) void run(); }, 5000);
    const changed = (event: StorageEvent) => { if (!event.key || event.key.startsWith(`${checkoutKey}:print:v1:`)) void run(); };
    window.addEventListener('storage', changed);
    return () => { active = false; clearInterval(timer); controller.abort(); window.removeEventListener('storage', changed); };
  }, [checkoutKey, latestOrderId]);
  if (!checkoutKey) return null;
  const attention = jobs.filter(job => !['submitted', 'cancelled'].includes(job.state));
  const shown = [...attention, ...jobs.filter(job => job.orderId === latestOrderId && !attention.includes(job))];
  return <details className="print-dispatch" open={Boolean(error || attention.length)}>
    <summary>Impresión {mode === 'mock' ? '· SIMULACIÓN LOCAL ' : ''}{attention.length ? `· ${attention.length} por revisar` : '· cliente y barra'}</summary>
    <div className="print-dispatch-body" aria-live="polite">
      {error && <p role="alert">{error}</p>}
      {shown.map(job => <div className="print-dispatch-job" key={`${job.orderId}:${job.audience}`}>
        <strong>#{job.ticket} · {labels[job.audience]}</strong><p>{job.queue}</p><p>{job.message}</p>
        {job.state === 'blocked' && <button disabled={busy} onClick={() => { void refresh.current(job.orderId, job.audience); }}>Reintentar {job.audience === 'customer' ? 'cliente' : 'barra'}</button>}
        {['uncertain', 'submitting'].includes(job.state) && <p>Revisa esta cola y el papel en Windows. No se reimprime para evitar duplicados.</p>}
      </div>)}
      {!shown.length && !error && <p>Las dos copias se envían al confirmar la venta. “Enviado a Windows” requiere comprobar la salida en papel.</p>}
      <button disabled={busy} onClick={() => { void refresh.current(); }}>{busy ? 'Comprobando…' : 'Actualizar impresión'}</button>
    </div>
  </details>;
}
