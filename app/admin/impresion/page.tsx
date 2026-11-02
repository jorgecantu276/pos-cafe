'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import type {SalePrintJob,PrintAudience} from '@/lib/sale-printing';
import type {PrintRecoveryAudit,PrintRecoveryAction} from '@/lib/print-journal-server';
import {SettingsGroup,SettingsNotice} from '../Settings';

type Job=SalePrintJob&{cashierId:string;canRetry?:boolean};
interface Reply {mode:'mock'|'windows';canManage:boolean;actorId:string;jobs:Job[];history:PrintRecoveryAudit[];cashiers:{id:string;full_name:string}[]}
interface Recovery {orderId:string;audience:PrintAudience;action:PrintRecoveryAction;requestId:string;reason:string;confirmed?:boolean}
const copy=(audience:PrintAudience)=>audience==='barista'?'Etiqueta del barista':'Ticket del cliente';
const key=(actor:string)=>`pos_print_recovery:v1:${actor}`;
const states:Record<Job['state'],string>={queued:'Pendiente',preparing:'Preparando',blocked:'Necesita atención',submitting:'Enviando',submitted:'Enviado',uncertain:'Por comprobar',cancelled:'Cancelado'};

export default function PrintRecoveryPage(){
  const [data,setData]=useState<Reply|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState<Job|null>(null),[action,setAction]=useState<'confirm_printed'|'replace_missing'>('confirm_printed');
  const reviewPanel=useRef<HTMLElement|null>(null);
  const [reason,setReason]=useState(''),[checked,setChecked]=useState(false),[pending,setPending]=useState<Recovery|null>(null);
  const load=useCallback(async()=>{
    const response=await fetch('/api/printing?scope=all',{cache:'no-store',headers:{'X-Pos-Print':'1'},signal:AbortSignal.timeout(12_000)});
    const reply=await response.json();if(!response.ok)throw Error(reply.error||'No se pudo cargar el estado de impresión.');
    if(reply.canManage!==true||typeof reply.actorId!=='string'||!Array.isArray(reply.jobs)||!Array.isArray(reply.history)||!Array.isArray(reply.cashiers))throw Error('No se pudo cargar el estado de impresión.');
    setData(reply);const saved=localStorage.getItem(key(reply.actorId));setPending(saved?JSON.parse(saved):null);
  },[]);
  useEffect(()=>{void Promise.resolve().then(load).catch(()=>setError('No se pudo cargar el estado de impresión.'));},[load]);
  useEffect(()=>{if(selected){reviewPanel.current?.focus({preventScroll:true});reviewPanel.current?.scrollIntoView?.({block:'start'});}},[selected]);
  const run=async(input:Recovery,recover=false)=>{
    if(busy||!data)return;setBusy(true);setError('');setMessage('');
    try{
      const saved=localStorage.getItem(key(data.actorId));
      if(saved&&!recover){setPending(JSON.parse(saved));throw Error('Hay una revisión pendiente. Compruébala antes de revisar otra copia.');}
      if(recover&&!saved)throw Error('No hay una revisión pendiente.');
      const request:Recovery=recover?JSON.parse(saved!):input;
      localStorage.setItem(key(data.actorId),JSON.stringify(request));setPending(request);
      const response=await fetch('/api/printing',{method:'POST',headers:{'X-Pos-Print':'1','Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(70_000)});
      const reply=await response.json();
      if(!response.ok){
        if([400,403,404,409].includes(response.status)){localStorage.removeItem(key(data.actorId));setPending(null);}
        throw Error(reply.error||'No se confirmó la revisión. Comprueba su estado antes de imprimir otra copia.');
      }
      if(!Array.isArray(reply.jobs))throw Error('No se confirmó la revisión. Comprueba su estado antes de imprimir otra copia.');
      localStorage.removeItem(key(data.actorId));setPending(null);setSelected(null);setReason('');setChecked(false);
      setMessage(request.action==='confirm_printed'?'Copia marcada como impresa.':request.action==='replace_missing'?'Reposición solicitada. Comprueba el estado.':'Revisión guardada. Comprueba esta copia.');
      await load();
    }catch(error){setError(error instanceof Error?error.message:'No se confirmó la revisión. No imprimas otra copia todavía.');}
    finally{setBusy(false);}
  };
  const name=(id:string)=>data?.cashiers.find(c=>c.id===id)?.full_name||'Cajero';
  return <div className="settings-page"><div className="settings-page-heading"><h1>Impresión</h1><button className="settings-button" disabled={busy} onClick={()=>void load().then(()=>setError('')).catch(()=>setError('No se pudo cargar el estado de impresión.'))}>Actualizar</button></div>
    {data?.mode==='mock'&&<SettingsNotice>Modo de prueba · No imprime en papel.</SettingsNotice>}
    {error&&<SettingsNotice error>{error}</SettingsNotice>}{message&&<SettingsNotice>{message}</SettingsNotice>}
    {pending&&<SettingsGroup title="Revisión pendiente"><div className="settings-editor"><SettingsNotice>Comprueba esta revisión antes de imprimir otra copia.</SettingsNotice><div><button disabled={busy} onClick={()=>void run(pending,true)}>Revisar cambio pendiente</button></div></div></SettingsGroup>}
    {!data&&!error&&<p role="status">Cargando impresión…</p>}
    {data&&<SettingsGroup title="Tickets y etiquetas">
      {!data.jobs.length&&<p className="settings-empty">Sin trabajos de impresión.</p>}
      {data.jobs.map(job=><article key={`${job.orderId}:${job.audience}`} className="settings-job">
        <div className="settings-job-heading"><h3>#{job.ticket} · {copy(job.audience)}</h3><span className="settings-badge">{states[job.state]}</span></div>
        <p>{name(job.cashierId)}</p>
        {(['queued','blocked'].includes(job.state)||job.canRetry)&&<button disabled={busy||!!pending} className="is-primary" onClick={()=>void run({orderId:job.orderId,audience:job.audience,action:'retry',requestId:crypto.randomUUID(),reason:'El responsable reanuda esta impresión pendiente.'})}>{job.state==='preparing'?'Reanudar impresión':'Reintentar esta copia'}</button>}
        {job.state==='preparing'&&<p>Espera a que termine. Si no avanza, actualiza en un minuto.</p>}
        {job.state==='submitting'&&<p>Espera y comprueba la impresora.</p>}
        {job.state==='uncertain'&&<><p>No imprimas otra copia hasta comprobar si ya salió.</p><button disabled={busy||!!pending} onClick={()=>{setSelected(job);setAction('confirm_printed');setReason('');setChecked(false);}}>Comprobar impresión</button></>}
        {job.state==='submitted'&&<button disabled={busy||!!pending} onClick={()=>{setSelected(job);setAction('replace_missing');setReason('');setChecked(false);}}>Falta esta copia</button>}
        <details className="settings-details"><summary>Detalles</summary><div><p>{job.queue}</p><p>{job.message}</p></div></details>
      </article>)}
    </SettingsGroup>}
    {selected&&<section ref={reviewPanel} tabIndex={-1} aria-label="Revisar copia" className="settings-group"><h2>Comprobar copia</h2><div className="settings-surface"><div className="settings-job">
      <h3>#{selected.ticket} · {copy(selected.audience)}</h3><p>Revisa el papel y los trabajos pendientes en Windows.</p>
      <div className="settings-editor"><label>¿Qué pasó con esta copia?<select aria-label="Resultado de revisión" disabled={busy} value={action} onChange={event=>{setAction(event.target.value as typeof action);setChecked(false);}}>
        {selected.state!=='submitted'&&<option value="confirm_printed">Ya salió en papel</option>}<option value="replace_missing">No salió</option></select></label>
      {action==='replace_missing'&&<SettingsNotice error>No la repongas si sigue pendiente en Windows: podría salir dos veces.</SettingsNotice>}
      <label className="settings-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={event=>setChecked(event.target.checked)}/>{action==='confirm_printed'?'La copia ya salió en papel.':'Comprobé que no salió y que no queda pendiente en Windows.'}</label>
      <label>¿Qué revisaste?<textarea aria-label="Motivo de revisión" placeholder="Describe la revisión" maxLength={300} value={reason} disabled={busy} onChange={event=>setReason(event.target.value)}/>{reason.trim().length>0&&reason.trim().length<10&&<small aria-live="polite">Añade un poco más de detalle.</small>}</label>
      <div className="settings-actions"><button className="is-primary" disabled={busy||!!pending||!checked||reason.trim().length<10} onClick={()=>void run({orderId:selected.orderId,audience:selected.audience,action,requestId:crypto.randomUUID(),reason:reason.trim(),confirmed:true})}>{action==='confirm_printed'?'Marcar como impresa':'Reponer esta copia'}</button><button disabled={busy} onClick={()=>setSelected(null)}>Cancelar</button></div></div>
    </div></div></section>}
    {!!data?.history.length&&<SettingsGroup title="Historial de revisiones">{data.history.map(item=><article key={item.requestId} className="settings-job settings-history"><h3>#{item.ticket} · {copy(item.audience)}</h3><p>{item.action==='confirm_printed'?'Copia impresa':item.action==='replace_missing'?'Reposición':'Reintento'} · {name(item.actor)}</p><p>{new Date(item.createdAt).toLocaleString('es-MX',{timeZone:'America/Matamoros'})}</p><details className="settings-details"><summary>Ver nota</summary><div><p>{item.reason}</p><p>Cajero: {name(item.owner)}</p></div></details></article>)}</SettingsGroup>}
  </div>;
}
