import { withDeadline } from './request-deadline';

// This is an explicit employee handoff decision, never an automatic resend.
export async function confirmClosingPrints(confirmAction: (message:string)=>boolean = window.confirm.bind(window)) {
  try {
    const response=await withDeadline(()=>fetch('/api/printing',{cache:'no-store',headers:{'X-Pos-Print':'1'},signal:AbortSignal.timeout(12_000)}));
    if(!response.ok)throw new Error('No se pudo consultar impresión');
    const result=await response.json();if(!Array.isArray(result.jobs))throw new Error('Respuesta de impresión incompleta');
    const pending=result.jobs.filter((job:{state:string})=>!['submitted','cancelled','confirmed_printed'].includes(job.state));
    if(!pending.length)return true;
    return confirmAction(`Hay ${pending.length} copias de impresión por revisar. No vuelvas a cobrar. Resuélvelas antes de salir o confirma que el responsable las revisará en Administración → Impresión. ¿Continuar con el cierre?`);
  } catch {
    return confirmAction('No se pudo comprobar la impresión. No vuelvas a cobrar ni reimprimas a ciegas. ¿El responsable revisará las copias pendientes en Administración → Impresión antes de continuar?');
  }
}
