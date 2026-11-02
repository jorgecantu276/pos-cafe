import type {SupabaseClient} from '@supabase/supabase-js';
import type {CartItem} from '../store/useCartStore';
import type {CheckoutPayload} from './checkout';
import {withDeadline} from './request-deadline';
import {isDefinitiveWriteRejection} from './write-outcome';

type Client=Pick<SupabaseClient,'rpc'>;
type Memory=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export interface PhoneOrder {
  id:string;folio:number|string;status:'pending'|'paid'|'cancelled';contact_name:string;contact_phone:string;customer_id:string|null;
  created_by:string;created_at:string;revision:number;paid_order_id:string|null;
  paid_sale_status?:string|null;
  snapshot:{items:CartItem[];total:number;customer_name:string;order_type:string;order_note:string;created_at:string;source:'phone';inventory_reserved:boolean};
}
export interface PhonePayload {items:CheckoutPayload['items'];expected_total:number;contact_name:string;contact_phone:string;customer_id:string|null;order_type:string;order_note:string}
export interface PhoneReturn {line_id:string;return_quantity:number}
export type PhoneRequest={actor:string;request:string;kind:'save';payload:PhonePayload}|{actor:string;request:string;kind:'cancel';id:string;revision:number;reason:string;returns:PhoneReturn[]};
export const phoneRequestKey=(actor:string)=>`pos_phone_request:v1:${actor}`;
export function validPhoneContact(name:string,phone:string){return name.trim().length>0&&name.trim().length<=120&&phone.length<=60&&/^[0-9+().\s-]+$/.test(phone)&&/^\d{10,15}$/.test(phone.replace(/\D/g,''));}
export function readPhoneOrder(value:unknown):PhoneOrder {
  const order=value as PhoneOrder;
  if(!order||typeof order.id!=='string'||!order.id||!/^\d+$/.test(String(order.folio))||!['pending','paid','cancelled'].includes(order.status)
    ||typeof order.contact_name!=='string'||typeof order.contact_phone!=='string'||!Number.isInteger(order.revision)||order.revision<0
    ||(order.customer_id!==null&&typeof order.customer_id!=='string')
    ||!Number.isFinite(Date.parse(order.created_at))||!order.snapshot||order.snapshot.source!=='phone'||!Number.isFinite(order.snapshot.total)||order.snapshot.total<=0
    ||typeof order.snapshot.order_type!=='string'||typeof order.snapshot.order_note!=='string'||typeof order.snapshot.customer_name!=='string'
    ||typeof order.snapshot.inventory_reserved!=='boolean'||!Array.isArray(order.snapshot.items)||!order.snapshot.items.length
    ||order.snapshot.items.some(line=>!line.id||!Number.isInteger(line.quantity)||line.quantity<1||!line.product?.id||!line.product.name||!Number.isFinite(line.product.price))) {
    throw new Error('No se pudo abrir el pedido. Actualiza la lista.');
  }
  return order;
}
export const canPrintPhoneOrder=(order:PhoneOrder)=>order.status==='pending'||(order.status==='paid'&&order.paid_sale_status==='completed');
export function phoneOrderStatusLabel(order:PhoneOrder){
  if(order.status==='pending')return 'Sin pagar';
  if(order.status==='cancelled')return 'Cancelado';
  if(order.paid_sale_status==='completed')return 'Pagado';
  if(['cancelled','canceled'].includes(order.paid_sale_status??''))return 'Venta cancelada';
  return 'Estado sin comprobar';
}
export async function listPhoneOrders(client:Client,search='',signal?:AbortSignal,before:string|null=null,status:'pending'|'paid'='pending'):Promise<PhoneOrder[]> {
  const {data,error}=await withDeadline(()=>client.rpc('pos_phone_list',{p_status:status,p_search:search,p_before:before}),{signal});
  if(error)throw new Error(error.message);if(!Array.isArray(data))throw new Error('No se pudieron cargar los pedidos.');return data.map(readPhoneOrder);
}
export async function getPhoneOrder(client:Client,id:string):Promise<PhoneOrder> {
  const {data,error}=await withDeadline(()=>client.rpc('pos_phone_get',{p_id:id}));if(error)throw new Error(error.message);const order=readPhoneOrder(data);if(order.id!==id)throw new Error('No se pudo confirmar este pedido. Actualiza la lista.');return order;
}
export function readPhoneRequest(storage:Memory,actor:string):PhoneRequest|null {
  const raw=storage.getItem(phoneRequestKey(actor));if(!raw)return null;
  try {
    const value=JSON.parse(raw) as PhoneRequest;
    if(!value||value.actor!==actor||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.request)||!['save','cancel'].includes(value.kind)
      ||(value.kind==='save'&&(!value.payload||typeof value.payload.contact_name!=='string'||typeof value.payload.contact_phone!=='string'||!validPhoneContact(value.payload.contact_name,value.payload.contact_phone)||!Array.isArray(value.payload.items)||!value.payload.items.length||!Number.isFinite(value.payload.expected_total)||value.payload.expected_total<=0
        ||!['En Local','Para Llevar'].includes(value.payload.order_type)||typeof value.payload.order_note!=='string'||value.payload.order_note.length>1000
        ||(value.payload.customer_id!==null&&typeof value.payload.customer_id!=='string')
        ||value.payload.items.some(line=>!line||typeof line.product_id!=='string'||!line.product_id||!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>1000||!Array.isArray(line.extra_ids)||!line.extra_ids.every(id=>typeof id==='string'&&id.length>0)||typeof line.note!=='string'||line.note.length>1000)))
      ||(value.kind==='cancel'&&(!value.id||!Number.isInteger(value.revision)||value.revision<0||typeof value.reason!=='string'||!value.reason.trim()||value.reason.length>200||!Array.isArray(value.returns)||value.returns.some(line=>!line.line_id||!Number.isInteger(line.return_quantity)||line.return_quantity<0))))throw new Error();
    return value;
  }catch{throw new Error('No se pudo abrir el pedido sin confirmar. Pide ayuda al responsable.');}
}
export async function withPhoneLock<T>(actor:string,action:()=>Promise<T>):Promise<T> {
  if(!actor||!navigator.locks)throw new Error('Espera a que cargue la sesión en Chrome o Edge.');
  return navigator.locks.request(phoneRequestKey(actor),{ifAvailable:true},async lock=>{if(!lock)throw new Error('Otra ventana está guardando un pedido.');return action();});
}
// Keep the request until the caller has also saved its print intent and retired
// only its original draft. A lost response is recovered with this exact identity.
export async function submitPhoneRequest(client:Client,storage:Memory,request:PhoneRequest):Promise<PhoneOrder> {
  const key=phoneRequestKey(request.actor),raw=JSON.stringify(request);
  if(storage.getItem(key)!==raw)throw new Error('El pedido cambió en otra ventana. Comprueba el pendiente.');
  const args=request.kind==='save'?{p_request:request.request,p_payload:request.payload}:{p_request:request.request,p_id:request.id,p_revision:request.revision,p_reason:request.reason,p_returns:request.returns};
  const {data,error}=await withDeadline(()=>client.rpc(request.kind==='save'?'pos_phone_save':'pos_phone_cancel',args));
  if(error){if(isDefinitiveWriteRejection(error.code)&&storage.getItem(key)===raw)storage.removeItem(key);throw new Error(error.message);}
  const order=readPhoneOrder(data);
  if(request.kind==='save'&&(order.contact_name!==request.payload.contact_name.trim()||order.snapshot.total!==request.payload.expected_total))throw new Error('No se confirmó el pedido. Pulsa Comprobar pedido.');
  if(request.kind==='cancel'&&(order.id!==request.id||order.status!=='cancelled'))throw new Error('No se confirmó la cancelación. Pulsa Comprobar pedido.');
  if(storage.getItem(key)!==raw)throw new Error('El pedido cambió en otra ventana. Comprueba el pendiente.');return order;
}
export function completePhoneRequest(storage:Memory,request:PhoneRequest){const key=phoneRequestKey(request.actor);if(storage.getItem(key)!==JSON.stringify(request))throw new Error('El pedido cambió en otra ventana.');storage.removeItem(key);}
export function beginPhoneRequest(storage:Memory,request:PhoneRequest){if(storage.getItem(phoneRequestKey(request.actor)))throw new Error('Comprueba el pedido sin confirmar antes de guardar otro.');storage.setItem(phoneRequestKey(request.actor),JSON.stringify(request));}
