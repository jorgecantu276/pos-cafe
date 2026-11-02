import type {SupabaseClient} from '@supabase/supabase-js';
import {withDeadline} from './request-deadline';
import {isDefinitiveWriteRejection} from './write-outcome';
import {readStaffPending,staffActiveKey,staffWriteLock} from './staff-requests';

type Memory=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Client=Pick<SupabaseClient,'rpc'>;
export interface StaffActivation {actor:string;request:string;id:string;revision:number;active:boolean}
export function readStaffActivation(storage:Memory,actor:string):StaffActivation|null{
  const raw=storage.getItem(staffActiveKey(actor));if(!raw)return null;
  try{const value=JSON.parse(raw) as StaffActivation;if(value.actor!==actor||typeof value.request!=='string'||!/^[-0-9a-f]{36}$/i.test(value.request)||typeof value.id!=='string'||!value.id||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.active!=='boolean')throw new Error();return value;}catch{throw new Error('No se pudo abrir el cambio de acceso pendiente. Pide ayuda al responsable.');}
}
export async function saveStaffActivation(client:Client,storage:Memory,actor:string,change?:{id:string;revision:number;active:boolean}){
  if(!actor||!navigator.locks)throw new Error('Espera a que cargue la sesión en Chrome o Edge.');
  return navigator.locks.request(staffWriteLock,{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Otra ventana está guardando un usuario.');
    if(readStaffPending(storage))throw new Error('Comprueba el usuario sin confirmar antes de cambiar su acceso.');
    let pending=readStaffActivation(storage,actor);
    if(change){
      if(pending)throw new Error('Comprueba el acceso pendiente antes de guardar otro cambio.');
      if(!change.id||!Number.isSafeInteger(change.revision)||change.revision<0)throw new Error('Actualiza el usuario antes de cambiar su acceso.');
      pending={actor,request:crypto.randomUUID(),...change};storage.setItem(staffActiveKey(actor),JSON.stringify(pending));
    }
    if(!pending)throw new Error('No hay un acceso pendiente de comprobar.');
    const key=staffActiveKey(actor),raw=JSON.stringify(pending);
    const{data,error}=await withDeadline(()=>client.rpc('pos_set_staff_active',{p_request:pending!.request,p_id:pending!.id,p_revision:pending!.revision,p_active:pending!.active}));
    if(error){if(isDefinitiveWriteRejection(error.code)&&storage.getItem(key)===raw)storage.removeItem(key);throw new Error(error.message);}
    if(data?.request_id!==pending.request||data.id!==pending.id||data.is_active!==pending.active||!Number.isSafeInteger(data.management_revision)||data.management_revision<pending.revision)throw new Error('No se confirmó el acceso. Pulsa Comprobar acceso.');
    if(storage.getItem(key)!==raw)throw new Error('El acceso cambió en otra ventana. Comprueba el pendiente.');
    storage.removeItem(key);return data as {id:string;is_active:boolean;management_revision:number};
  });
}
