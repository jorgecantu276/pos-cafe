import type {SupabaseClient} from '@supabase/supabase-js';
import type {PrintJournal} from './print-journal-server';
import type {PrintConfig} from './windows-print-server';
import {phoneOrderDocuments,type PhonePreparation,type PrintAudience} from './sale-printing';
import {AccessError} from './user-management';
import {withDeadline} from './request-deadline';

export interface PhonePrintRecord extends PhonePreparation {created_by:string;status:'pending'|'paid'|'cancelled';paid_order_id:string|null;paid_sale_status:string|null}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function readPhonePreparation(client:SupabaseClient,id:string,signal:AbortSignal):Promise<PhonePrintRecord>{
  const result=await withDeadline(()=>client.rpc('pos_phone_print_state',{p_id:id}),{signal:AbortSignal.any([signal,AbortSignal.timeout(12_000)])});
  if(result.error)throw new AccessError('No se pudo consultar el pedido por teléfono.',503);
  const order=result.data as PhonePrintRecord|null;
  if(!order||order.id!==id||!uuid.test(order.created_by)||!['pending','paid','cancelled'].includes(order.status))throw new AccessError('Pedido no encontrado.',404);
  if(order.status==='paid'&&!['completed','cancelled','canceled'].includes(order.paid_sale_status??''))throw new AccessError('No se pudo confirmar el estado de pago del pedido.',503);
  return order;
}
export const phonePreparationEligible=(phone:PhonePrintRecord)=>phone.status==='pending'||(phone.status==='paid'&&phone.paid_sale_status==='completed');
export function ensurePhonePreparation(journal:PrintJournal,phone:PhonePrintRecord,config:PrintConfig){
  const id=`phone:${phone.id}`,owner=phone.created_by;
  if(!phonePreparationEligible(phone)){journal.cancel(owner,id);throw new AccessError('Pedido cancelado. No se enviaron copias nuevas.',409);}
  // Payment metadata may change; the accepted preparation and its identity do not.
  const source={id,ticket_number:`T${phone.folio}`,contact_name:phone.contact_name,contact_phone:phone.contact_phone,snapshot:phone.snapshot};
  journal.ensureDocuments(owner,source,config.queues,phoneOrderDocuments(phone));
  return {id,owner};
}
export async function dispatchPhonePreparation(client:SupabaseClient,journal:PrintJournal,phone:PhonePrintRecord,signal:AbortSignal,only?:PrintAudience){
  return journal.dispatch(phone.created_by,`phone:${phone.id}`,only,async()=>phonePreparationEligible(await readPhonePreparation(client,phone.id,signal)));
}
