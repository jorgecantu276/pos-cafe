import type {SupabaseClient} from '@supabase/supabase-js';
import type {PrintJournal} from './print-journal-server';
import type {PrintConfig} from './windows-print-server';
import {requireLocalPrintRequest} from './print-dispatch-server';
import {phoneOrderDocuments,type PhonePreparation} from './sale-printing';
import {AccessError,isAuthUnavailable} from './user-management';
import {withDeadline} from './request-deadline';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface PhonePrintRecord extends PhonePreparation {created_by:string;status:'pending'|'paid'|'cancelled';paid_sale_status:string|null}

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
  if(recovery&&(profile.data.role!=='admin'||!input.audience))throw new AccessError('Esta revisión requiere al responsable y una copia específica.',403);
  if(recovery&&(typeof input.requestId!=='string'||!uuid.test(input.requestId)||typeof input.reason!=='string'
    ||input.reason.trim().length<10||input.reason.length>300||(input.action!=='retry'&&input.confirmed!==true)))throw new AccessError('Confirma la revisión del papel y escribe el motivo.',400);
  if(!recovery&&['requestId','reason','confirmed'].some(key=>key in input))throw new AccessError('Solicitud de impresión inválida.',400);
  const read=async()=>{
    const result=await withDeadline(()=>client.rpc('pos_phone_print_state',{p_id:input.phoneOrderId}),{signal:AbortSignal.any([request.signal,AbortSignal.timeout(12_000)])});
    if(result.error)throw new AccessError('No se pudo consultar el pedido por teléfono.',503);
    const order=result.data as PhonePrintRecord|null;
    if(!order||order.id!==input.phoneOrderId||!uuid.test(order.created_by)||!['pending','paid','cancelled'].includes(order.status))throw new AccessError('Pedido no encontrado.',404);
    if(order.status==='paid'&&!['completed','cancelled','canceled'].includes(order.paid_sale_status??''))throw new AccessError('No se pudo confirmar el estado de pago del pedido.',503);
    return order;
  };
  const phone=await read(),owner=phone.created_by,id=`phone:${phone.id}`;
  if(request.method==='GET')return {mode:config.mode,canManage:profile.data.role==='admin',jobs:journal.get(owner,id)};
  if(recovery&&!journal.get(owner,id).some(job=>job.audience===input.audience))throw new AccessError('No existe esta copia en el registro local.',409);
  if(recovery&&input.action==='confirm_printed'){
    try{journal.authorizeRecovery({requestId:input.requestId,actor:user.id,owner,orderId:id,audience:input.audience,action:input.action,reason:input.reason.trim()});}
    catch(error){throw new AccessError(error instanceof Error?error.message:'No se pudo resolver esta copia.',409);}
    return {mode:config.mode,canManage:true,jobs:journal.get(owner,id)};
  }
  const eligible=(phone:PhonePrintRecord)=>phone.status==='pending'||(phone.status==='paid'&&phone.paid_sale_status==='completed');
  if(!eligible(phone)){
    journal.cancel(owner,id);throw new AccessError('Pedido cancelado. No se enviaron copias nuevas.',409);
  }
  // Hash only the immutable accepted document, not later payment/revision metadata.
  const source={id,ticket_number:`T${phone.folio}`,contact_name:phone.contact_name,contact_phone:phone.contact_phone,snapshot:phone.snapshot};
  journal.ensureDocuments(owner,source,config.queues,phoneOrderDocuments(phone));
  if(recovery){
    try{journal.authorizeRecovery({requestId:input.requestId,actor:user.id,owner,orderId:id,audience:input.audience,action:input.action,reason:input.reason.trim()});}
    catch(error){throw new AccessError(error instanceof Error?error.message:'No se pudo resolver esta copia.',409);}
  }
  return {mode:config.mode,canManage:profile.data.role==='admin',jobs:await journal.dispatch(owner,id,input.audience,async()=>{
    return eligible(await read());
  })};
}
