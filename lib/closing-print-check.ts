import { withDeadline } from './request-deadline';

// This is an explicit employee handoff decision, never an automatic resend.
export async function confirmClosingPrints(confirmAction: (message:string)=>boolean = window.confirm.bind(window)) {
  try {
    const response=await withDeadline(()=>fetch('/api/printing',{cache:'no-store',headers:{'X-Pos-Print':'1'},signal:AbortSignal.timeout(12_000)}));
    if(!response.ok)throw new Error('No se pudo consultar impresión');
    const result=await response.json();if(!Array.isArray(result.jobs))throw new Error('Respuesta de impresión incompleta');
    const pending=result.jobs.filter((job:{state:string})=>!['submitted','cancelled','confirmed_printed'].includes(job.state));
    if(!pending.length)return true;
    return confirmAction(`Hay ${pending.length} copias pendientes. No vuelvas a cobrar. ¿Continuar con el cierre y dejar su revisión al responsable en Administración → Impresión?`);
  } catch {
    return confirmAction('No se pudo consultar la impresión. No vuelvas a cobrar ni imprimas otra copia sin revisarla. ¿Continuar con el cierre y dejar la revisión al responsable en Administración → Impresión?');
  }
}
