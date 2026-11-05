import type {SupabaseClient} from '@supabase/supabase-js';
import type {PrintJournal} from './print-journal-server';
import type {PrintConfig} from './windows-print-server';
import {requireLocalPrintRequest} from './print-dispatch-server';
import {dispatchPhonePreparation,ensurePhonePreparation,readPhonePreparation} from './phone-preparation-server';
import {AccessError,isAuthUnavailable} from './user-management';
import {withDeadline} from './request-deadline';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handlePhonePrintRequest(request:Request,client:SupabaseClient,journal:PrintJournal,config:PrintConfig) {
  requireLocalPrintRequest(request);
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(12_000)]);
  const {data:{user},error}=await withDeadline(()=>client.auth.getUser(),{signal});
  if(isAuthUnavailable(error))throw new AccessError('No se pudo comprobar la sesión.',503);
  if(error||!user)throw new AccessError('Inicia sesión para consultar la impresión.',401);
  const profile=await withDeadline(()=>client.from('profiles').select('role,is_active').eq('id',user.id).abortSignal(signal).single(),{signal});
  if(profile.error)throw new AccessError('No se pudo comprobar el acceso.',503);
  if(!profile.data?.is_active||!['admin','cashier','barista'].includes(profile.data.role))throw new AccessError('Sin acceso a impresión.',403);
  let input;
  if(request.method==='GET')input=Object.fromEntries(new URL(request.url).searchParams);
  else {
    const raw=await request.text();if(raw.length>2048)throw new AccessError('Solicitud de impresión inválida.',400);
    try{input=JSON.parse(raw);}catch{throw new AccessError('Solicitud de impresión inválida.',400);}
  }
  if(!input||typeof input.phoneOrderId!=='string'||!uuid.test(input.phoneOrderId)
    ||Object.keys(input).some(key=>!['phoneOrderId','audience','action','requestId','reason','confirmed'].includes(key))
    ||(input.audience!==undefined&&!['customer','barista'].includes(input.audience))
    ||(input.action!==undefined&&!['retry','confirm_printed','replace_missing'].includes(input.action)))throw new AccessError('Solicitud de impresión inválida.',400);
  const recovery=input.action!==undefined;
  if(recovery&&(profile.data.role!=='admin'||!input.audience))throw new AccessError('Solo el responsable puede revisar una copia. Selecciona el ticket o la etiqueta.',403);
  if(recovery&&(typeof input.requestId!=='string'||!uuid.test(input.requestId)||typeof input.reason!=='string'
    ||input.reason.trim().length<10||input.reason.length>300||(input.action!=='retry'&&input.confirmed!==true)))throw new AccessError('Confirma que revisaste el papel y la cola de Windows. Escribe un motivo de 10 a 300 caracteres.',400);
  if(!recovery&&['requestId','reason','confirmed'].some(key=>key in input))throw new AccessError('Solicitud de impresión inválida.',400);
  const phone=await readPhonePreparation(client,input.phoneOrderId,request.signal),owner=phone.created_by,id=`phone:${phone.id}`;
  if(request.method==='GET')return {mode:config.mode,canManage:profile.data.role==='admin',jobs:journal.get(owner,id)};
  if(recovery&&!journal.get(owner,id).some(job=>job.audience===input.audience))throw new AccessError('No existe esta copia en el registro local.',409);
  if(recovery&&input.action==='confirm_printed'){
    try{journal.authorizeRecovery({requestId:input.requestId,actor:user.id,owner,orderId:id,audience:input.audience,action:input.action,reason:input.reason.trim()});}
    catch(error){throw new AccessError(error instanceof Error?error.message:'No se pudo resolver esta copia.',409);}
    return {mode:config.mode,canManage:true,jobs:journal.get(owner,id)};
  }
  ensurePhonePreparation(journal,phone,config);
  if(recovery){
    try{journal.authorizeRecovery({requestId:input.requestId,actor:user.id,owner,orderId:id,audience:input.audience,action:input.action,reason:input.reason.trim()});}
    catch(error){throw new AccessError(error instanceof Error?error.message:'No se pudo resolver esta copia.',409);}
  }
  return {mode:config.mode,canManage:profile.data.role==='admin',jobs:await dispatchPhonePreparation(client,journal,phone,request.signal,input.audience)};
}
