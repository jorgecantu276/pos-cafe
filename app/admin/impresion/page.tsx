'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {SalePrintJob,PrintAudience} from '@/lib/sale-printing';
import type {PrintRecoveryAudit,PrintRecoveryAction} from '@/lib/print-journal-server';

type Job=SalePrintJob&{cashierId:string;canRetry?:boolean};
interface Reply {mode:'mock'|'windows';canManage:boolean;actorId:string;jobs:Job[];history:PrintRecoveryAudit[];cashiers:{id:string;full_name:string}[]}
interface Recovery {orderId:string;audience:PrintAudience;action:PrintRecoveryAction;requestId:string;reason:string;confirmed?:boolean}
const copy=(audience:PrintAudience)=>audience==='barista'?'Barra / etiqueta':'Cliente / ticket';
const key=(actor:string)=>`pos_print_recovery:v1:${actor}`;

export default function PrintRecoveryPage(){
  const [data,setData]=useState<Reply|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Job|null>(null),[action,setAction]=useState<'confirm_printed'|'replace_missing'>('confirm_printed');
  const reviewPanel=useRef<HTMLElement|null>(null);
  const [reason,setReason]=useState(''),[checked,setChecked]=useState(false),[pending,setPending]=useState<Recovery|null>(null);
  const load=useCallback(async()=>{
    const response=await fetch('/api/printing?scope=all',{cache:'no-store',headers:{'X-Pos-Print':'1'},signal:AbortSignal.timeout(12_000)});
    const reply=await response.json();if(!response.ok)throw Error(reply.error||'No se pudo consultar la impresión.');
    if(reply.canManage!==true||typeof reply.actorId!=='string'||!Array.isArray(reply.jobs)||!Array.isArray(reply.history)||!Array.isArray(reply.cashiers))throw Error('Respuesta de impresión inválida.');
    setData(reply);const saved=localStorage.getItem(key(reply.actorId));setPending(saved?JSON.parse(saved):null);
  },[]);
  useEffect(()=>{void Promise.resolve().then(load).catch(error=>setError(error instanceof Error?error.message:'No se pudo consultar la impresión.'));},[load]);
  useEffect(()=>{if(selected){reviewPanel.current?.focus({preventScroll:true});reviewPanel.current?.scrollIntoView?.({block:'start'});}},[selected]);
  const run=async(input:Recovery)=>{
    if(busy||!data)return;setBusy(true);setError('');setMessage('');
    try{
      const saved=localStorage.getItem(key(data.actorId));
      const request:Recovery=saved?JSON.parse(saved):input;
      localStorage.setItem(key(data.actorId),JSON.stringify(request));setPending(request);
      const response=await fetch('/api/printing',{method:'POST',headers:{'X-Pos-Print':'1','Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(70_000)});
      const reply=await response.json();
      if(!response.ok){
        if([400,403,404,409].includes(response.status)){localStorage.removeItem(key(data.actorId));setPending(null);}
        throw Error(reply.error||'No se confirmó la revisión. Recupera la misma solicitud.');
      }
      if(!Array.isArray(reply.jobs))throw Error('No se confirmó la revisión. Recupera la misma solicitud.');
      localStorage.removeItem(key(data.actorId));setPending(null);setSelected(null);setReason('');setChecked(false);
      setMessage(request.action==='confirm_printed'?'Salida en papel confirmada y registrada. No se reenvió.':'Revisión registrada. Comprueba el estado de esta copia y su salida en papel.');
      await load();
    }catch(error){setError(error instanceof Error?error.message:'No se confirmó la revisión. Recupera la misma solicitud.');}
    finally{setBusy(false);}
  };
  const name=(id:string)=>data?.cashiers.find(c=>c.id===id)?.full_name||id;
  return <div className="space-y-6 max-w-5xl"><h1 className="text-2xl font-bold">Recuperar impresión</h1>
    <p>Revisa las copias de todos los cajeros, aunque su turno ya terminó. Estas acciones no cobran ni modifican la venta.</p>
    {data?.mode==='mock'&&<p role="status" className="border rounded p-3">SIMULACIÓN: no se envía papel a las impresoras.</p>}
    <button className="border rounded p-3" disabled={busy} onClick={()=>void load().then(()=>setError('')).catch(error=>setError(error.message))}>Actualizar impresión</button>
    {error&&<p role="alert" className="text-red-700">{error}</p>}{message&&<p role="status">{message}</p>}
    {pending&&<section className="border rounded p-4"><p>Hay una revisión sin confirmar. Recupera exactamente la misma solicitud antes de iniciar otra.</p>
      <button className="border rounded p-3" disabled={busy} onClick={()=>void run(pending)}>Recuperar revisión pendiente</button></section>}
    {!data&&!error&&<p>Cargando impresión…</p>}
    {data&&<section className="space-y-3"><h2 className="text-xl font-bold">Pendientes y últimas copias</h2>
      {!data.jobs.length&&<p>No hay copias registradas en esta PC.</p>}
      {data.jobs.map(job=><article key={`${job.orderId}:${job.audience}`} className="border rounded-xl bg-white p-4 space-y-2">
        <h3 className="font-bold">#{job.ticket} · {copy(job.audience)} · {name(job.cashierId)}</h3><p>{job.queue}</p><p>{job.message}</p>
        {(['queued','blocked'].includes(job.state)||job.canRetry)&&<button disabled={busy||!!pending} className="border rounded p-3" onClick={()=>void run({orderId:job.orderId,audience:job.audience,action:'retry',requestId:crypto.randomUUID(),reason:'Responsable reintenta copia bloqueada o pendiente.'})}>{job.state==='preparing'?'Recuperar preparación interrumpida':'Reintentar solo esta copia'}</button>}
        {job.state==='preparing'&&<p>Preparación en curso. Si Windows se interrumpió, espera un minuto, actualiza y recupera la copia.</p>}
        {job.state==='submitting'&&<p>Envío activo. Espera y revisa Windows antes de resolverlo.</p>}
        {job.state==='uncertain'&&<button disabled={busy||!!pending} className="border rounded p-3" onClick={()=>{setSelected(job);setAction('confirm_printed');setReason('');setChecked(false);}}>Revisar resultado incierto</button>}
        {job.state==='submitted'&&<button disabled={busy||!!pending} className="border rounded p-3" onClick={()=>{setSelected(job);setAction('replace_missing');setReason('');setChecked(false);}}>Revisar copia no recibida</button>}
      </article>)}
    </section>}
    {selected&&<section ref={reviewPanel} tabIndex={-1} aria-label="Revisar copia" className="border-2 border-amber-500 rounded-xl bg-white p-5 space-y-3">
      <h2 className="font-bold">#{selected.ticket} · {copy(selected.audience)} · {name(selected.cashierId)}</h2>
      <p>Revisa la impresora, el papel y la cola de Windows. Una copia pendiente en Windows puede salir más tarde.</p>
      <label className="block">Resultado de la revisión<select aria-label="Resultado de revisión" className="block border rounded p-3" disabled={busy} value={action} onChange={event=>{setAction(event.target.value as typeof action);setChecked(false);}}>
        {selected.state!=='submitted'&&<option value="confirm_printed">La copia ya salió: registrar sin reenviar</option>}<option value="replace_missing">No salió: autorizar una reposición</option></select></label>
      {action==='replace_missing'&&<p role="alert" className="font-bold text-red-700">RIESGO DE DUPLICADO: autoriza solo si comprobaste que no salió y que no queda ningún trabajo pendiente en esa cola. Se reenviará únicamente esta copia.</p>}
      <label className="block"><input type="checkbox" checked={checked} disabled={busy} onChange={event=>setChecked(event.target.checked)}/>{action==='confirm_printed'?' Confirmé físicamente que esta copia salió.':' Revisé el papel, no salió esta copia y la cola de Windows no tiene ningún trabajo pendiente para ella.'}</label>
      <label className="block">Motivo / comprobación realizada (mínimo 10 caracteres)<textarea aria-label="Motivo de revisión" className="block border rounded p-3 w-full" maxLength={300} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/></label>
      <button className="border rounded p-3 font-bold" disabled={busy||!!pending||!checked||reason.trim().length<10} onClick={()=>void run({orderId:selected.orderId,audience:selected.audience,action,requestId:crypto.randomUUID(),reason:reason.trim(),confirmed:true})}>{action==='confirm_printed'?'Registrar papel confirmado sin reenviar':'Autorizar UNA reposición de esta copia'}</button>
      <button className="border rounded p-3" disabled={busy} onClick={()=>setSelected(null)}>Volver sin cambiar</button>
    </section>}
    {!!data?.history.length&&<section className="space-y-3"><h2 className="text-xl font-bold">Últimas 50 revisiones del responsable</h2>{data.history.map(item=><article key={item.requestId} className="border rounded p-3"><p>#{item.ticket} · {new Date(item.createdAt).toLocaleString('es-MX',{timeZone:'America/Matamoros'})} · {name(item.actor)} · {copy(item.audience)}</p><p>{item.action==='confirm_printed'?'Papel confirmado sin reenviar':item.action==='replace_missing'?'Reposición autorizada':'Reintento seguro'} · Cajero original: {name(item.owner)}</p><p>{item.reason}</p></article>)}</section>}
  </div>;
}
