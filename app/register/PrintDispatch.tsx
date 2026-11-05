'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Printer } from 'lucide-react';
import { forgetSalePrint, pendingSalePrints, printRequestTarget, type PrintAudience, type SalePrintJob } from '@/lib/sale-printing';

interface Reply { mode: 'mock' | 'windows'; jobs: SalePrintJob[]; canManage?: boolean; expectedCopies?:1|2 }
const labels = { customer: 'Ticket del cliente', barista: 'Etiquetas del barista' };
const stateLabels: Record<SalePrintJob['state'], string> = {
  queued: 'En espera', preparing: 'Preparando impresión…', submitting: 'Enviando…',
  submitted: 'Enviado a Windows', blocked: 'Impresión detenida', uncertain: 'Salida por comprobar', cancelled: 'Cancelado',
};
export default function PrintDispatch({ checkoutKey, latestOrderId }: { checkoutKey: string; latestOrderId?: string }) {
  const [jobs, setJobs] = useState<SalePrintJob[]>([]), [error, setError] = useState(''), [mode, setMode] = useState('');
  const [busy, setBusy] = useState(false);
  const [canManage,setCanManage] = useState(false);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const [panelPosition,setPanelPosition] = useState({top:54,right:12,height:420});
  const placePanel = useCallback(() => {
    const node=disclosure.current;
    if(!node?.open)return;
    const bounds=node.getBoundingClientRect();
    const top=Math.max(8,Math.min(bounds.bottom+6,window.innerHeight-160));
    const right=Math.max(12,window.innerWidth-bounds.right);
    const height=Math.max(120,Math.min(420,window.innerHeight-top-12));
    setPanelPosition(current=>current.top===top&&current.right===right&&current.height===height?current:{top,right,height});
  },[]);
  useEffect(()=>{
    window.addEventListener('resize',placePanel);
    window.addEventListener('scroll',placePanel,true);
    return()=>{window.removeEventListener('resize',placePanel);window.removeEventListener('scroll',placePanel,true);};
  },[placePanel]);
  const refresh = useRef<(orderId?: string, audience?: PrintAudience) => Promise<void>>(async () => {});
  useEffect(() => {
    if (!checkoutKey) return;
    let active = true, running = false, pollNeeded = true;
    const controller = new AbortController();
    const request = async (orderId?: string, audience?: PrintAudience): Promise<Reply> => {
      const target=orderId?printRequestTarget(orderId):{url:'/api/printing',body:{}};
      const result = await fetch(target.url, { method: orderId ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Pos-Print': '1', ...(orderId ? { 'Content-Type': 'application/json' } : {}) },
        body: orderId ? JSON.stringify({ ...target.body, ...(audience ? { audience } : {}) }) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]) });
      const data = await result.json();
      if (!result.ok) {
        // A cancelled/withheld sale needs no automatic resend after refresh.
        if (orderId && result.status === 409) forgetSalePrint(localStorage, checkoutKey, orderId);
        throw new Error(data.error || 'No se pudo consultar la impresión.');
      }
      if (!Array.isArray(data.jobs) || !['mock', 'windows'].includes(data.mode)) throw new Error('No se pudo comprobar la impresión.');
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
          if (sent.jobs.length === (sent.expectedCopies??2)) forgetSalePrint(localStorage, checkoutKey, orderId);
        }));
        if (pending.size) result = await request();
        if (active) {
          setJobs(result.jobs); setMode(result.mode);setCanManage(result.canManage === true);
          const failure = outcomes.find(outcome => outcome.status === 'rejected');
          pollNeeded = Boolean(failure) || result.jobs.some(job => ['queued', 'preparing', 'submitting'].includes(job.state));
          setError(failure?.status === 'rejected' ? String(failure.reason?.message || 'No se pudo enviar la impresión.') : '');
        }
      } catch (failure) { pollNeeded = true; if (active) setError(failure instanceof Error ? failure.message : 'No se pudo consultar la impresión.'); }
      finally { running = false; if (active) setBusy(false); }
    };
    refresh.current = run;
    void run();
    const timer = setInterval(() => { if (pollNeeded) void run(); }, 5000);
    const changed = (event: StorageEvent) => { if (!event.key || event.key.startsWith(`${checkoutKey}:print:v1:`)) void run(); };
    const pending=()=>{void run();};
    window.addEventListener('storage', changed);
    window.addEventListener('pos-print-pending',pending);
    return () => { active = false; clearInterval(timer); controller.abort(); window.removeEventListener('storage', changed);window.removeEventListener('pos-print-pending',pending); };
  }, [checkoutKey, latestOrderId]);
  if (!checkoutKey) return null;
  const attention = jobs.filter(job => !['submitted', 'cancelled'].includes(job.state));
  const shown = [...attention, ...jobs.filter(job => job.orderId === latestOrderId && !attention.includes(job))];
  const needsReview = attention.some(job => ['blocked', 'uncertain'].includes(job.state));
  const status = error ? 'Estado sin comprobar' : needsReview ? 'Por revisar' : attention.length ? 'En curso' : mode ? 'Sin pendientes' : 'Comprobando…';
  return <details ref={disclosure} onToggle={placePanel} className={`print-dispatch${error || needsReview ? ' has-attention' : ''}`}>
    <summary>
      <Printer size={18} aria-hidden="true"/><strong>Impresión</strong>
      <span className="print-dispatch-status" role="status" aria-live="polite">{status}</span>
      {attention.length > 0 && <span className="print-dispatch-count" role="status" aria-label={`${attention.length} ${attention.length === 1 ? 'copia pendiente' : 'copias pendientes'}`}>{attention.length}</span>}
      {mode === 'mock' && <span className="print-dispatch-mode">Prueba</span>}
      <ChevronDown className="print-dispatch-chevron" size={18} aria-hidden="true"/>
    </summary>
    <div className="print-dispatch-body" role="region" aria-label="Detalles de impresión" style={{'--print-panel-top':`${panelPosition.top}px`,'--print-panel-right':`${panelPosition.right}px`,'--print-panel-height':`${panelPosition.height}px`} as CSSProperties}>
      {error && <><p role="alert">No se pudo comprobar la impresión.</p><details><summary>Detalles</summary><p>{error}</p></details></>}
      {shown.map(job => <div className="print-dispatch-job" key={`${job.orderId}:${job.audience}`}>
        <strong>#{job.ticket} · {labels[job.audience]}</strong><p>{stateLabels[job.state]}</p>
        {['blocked','uncertain'].includes(job.state) && <details><summary>Detalles de impresión</summary><p>{job.queue}</p><p>{job.message}</p></details>}
        {job.state === 'blocked' && <button disabled={busy} onClick={() => { void refresh.current(job.orderId, job.audience); }}>Reintentar {job.audience === 'customer' ? 'cliente' : 'barra'}</button>}
        {['uncertain', 'submitting'].includes(job.state) && <p>Revisa el papel y la cola de Windows antes de imprimir otra copia. Si hay dudas, avisa al responsable.</p>}
      </div>)}
      {!shown.length && !error && <p>{mode ? 'Sin impresiones pendientes.' : 'Comprobando impresión…'}</p>}
      {attention.length>0&&<p>Revisa las copias pendientes antes de entregar la caja.</p>}
      {canManage&&<a href="/admin/impresion">Comprobar impresión</a>}
      <button disabled={busy} onClick={() => { void refresh.current(); }}>{busy ? 'Comprobando…' : 'Actualizar impresión'}</button>
    </div>
  </details>;
}
