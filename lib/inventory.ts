import type { SupabaseClient } from '@supabase/supabase-js';

export type InventoryMode = 'product' | 'recipe' | 'both' | 'untracked';
export const inventoryModes: Record<InventoryMode,string> = {
  product: 'Piezas terminadas', recipe: 'Ingredientes por receta', both: 'Piezas e ingredientes', untracked: 'Sin conteo de inventario',
};
export interface InventoryProduct {
  id:string; name:string; price:number; stock:number; is_active:boolean; category:string;
  inventory_mode:InventoryMode; stock_product_id:string|null; stock_units:number; inventory_revision:number;
  customizable:boolean; wizard_steps:string[]|null;
}
export interface InventorySupply {id:string;name:string;unit:string;current_stock:number;inventory_revision:number;is_active:boolean}
export interface InventoryRecipe {product_id:string;extra_ids:string[];ingredients:{supply_id:string;quantity:number}[]}
export interface InventoryMovement {id:string;target_kind:string;target_id:string;target_name:string;unit:string;operation:string;
  quantity_before:number;quantity_after:number;delta:number;reason:string;created_at:string;order_id:string|null}
type Operation = 'movement'|'policy'|'recipe';
type Payload = Record<string,unknown>;
type Client = Pick<SupabaseClient,'rpc'>;
interface Pending {version:1;actor:string;request:string;operation:Operation;payload:Payload}
interface Receipt {request_id:string;actor_id:string;operation:Operation;id:string;revision:number}
const rpcNames:Record<Operation,string>={movement:'pos_adjust_inventory',policy:'pos_configure_inventory',recipe:'pos_save_inventory_recipe'};
export const inventoryRequestKey=(actor:string)=>`mi_cafe_inventory_request:v1:${actor}`;

// Supplies use the verified numeric(10,2) base-unit contract. Convert decimal
// strings exactly; reject precision loss instead of rounding a stock movement.
export function inventoryQuantity(value:string,unit:string):number {
  if(!/^\d+(?:[.,]\d{1,4})?$/.test(value.trim()))throw new Error('Introduce una cantidad positiva válida.');
  const [whole,fraction='']=value.trim().replace(',','.').split('.');
  const scaled=BigInt(whole)*BigInt('10000')+BigInt(fraction.padEnd(4,'0'));
  const factor:Record<string,bigint>={pza:BigInt('100'),ml:BigInt('100'),gr:BigInt('100'),lt:BigInt('100000'),kg:BigInt('100000'),oz:BigInt('2957')};
  if(!(unit in factor))throw new Error('Unidad no admitida.');
  const numerator=scaled*factor[unit];
  if(numerator%BigInt('10000')!==BigInt('0'))throw new Error('La cantidad debe conservar como máximo dos decimales en la unidad base.');
  const cents=numerator/BigInt('10000');
  if(cents>BigInt('9999999999') || (unit==='pza'&&cents%BigInt('100')!==BigInt('0')))throw new Error('Revisa la cantidad y las piezas enteras.');
  return Number(cents)/100;
}
export function stockQuantity(value:string,inputUnit:string,baseUnit:string):number{
  const allowed:Record<string,string[]>={ml:['ml','lt','oz'],gr:['gr','kg'],pza:['pza']};
  if(!allowed[baseUnit]?.includes(inputUnit))throw new Error('La unidad de este insumo requiere conciliación. No se convirtió ni cambió el saldo.');
  return inventoryQuantity(value,inputUnit);
}
export function readInventoryRequest(storage:Storage,actor:string):Pending|null {
  const raw=storage.getItem(inventoryRequestKey(actor));if(!raw)return null;
  const p=JSON.parse(raw) as Pending;
  if(p.version!==1||p.actor!==actor||typeof p.request!=='string'||!Object.hasOwn(rpcNames,p.operation)
    ||!p.payload||p.payload.actor_id!==actor||typeof p.payload.id!=='string')throw new Error('Solicitud de inventario ilegible. Conserva el registro para revisión.');
  return p;
}
async function execute(client:Client,storage:Storage,p:Pending,signal?:AbortSignal):Promise<Receipt> {
  const key=inventoryRequestKey(p.actor),raw=JSON.stringify(p),controller=new AbortController();
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  if(combined.aborted)throw new Error('Consulta interrumpida. Recupera la misma solicitud.');
  let onAbort!:()=>void;
  const aborted=new Promise<never>((_,reject)=>{onAbort=()=>reject(new Error('No se confirmó el movimiento. Recupera la misma solicitud; no lo registres otra vez.'));});
  combined.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>controller.abort(),12000);
  try {
    const {data,error}=await Promise.race([client.rpc(rpcNames[p.operation],{p_request:p.request,p_payload:p.payload}).abortSignal(combined),aborted]);
    if(error){
      // Permission/auth/lock failures can happen before the journal replay
      // lookup; they cannot establish that an earlier attempt never committed.
      if((error.code==='P0001'||/^(22|23)[0-9A-Z]{3}$/.test(error.code||''))&&storage.getItem(key)===raw)storage.removeItem(key);
      throw new Error(error.message);
    }
    const receipt=data as Receipt;
    if(!receipt||receipt.request_id!==p.request||receipt.actor_id!==p.actor||receipt.operation!==p.operation
      ||receipt.id!==p.payload.id||!Number.isSafeInteger(receipt.revision)||receipt.revision<0)throw new Error('Respuesta de inventario inválida. Recupera la misma solicitud.');
    if(storage.getItem(key)!==raw)throw new Error('La solicitud pendiente cambió. Revisa el historial antes de continuar.');
    storage.removeItem(key);return receipt;
  } finally {clearTimeout(timer);combined.removeEventListener('abort',onAbort);}
}
async function locked<T>(actor:string,action:()=>Promise<T>):Promise<T>{
  if(!navigator.locks)throw new Error('Actualiza Chrome o Edge para guardar inventario entre ventanas.');
  return navigator.locks.request(inventoryRequestKey(actor),{ifAvailable:true},async lock=>{
    if(!lock)throw new Error('Otra ventana está guardando inventario. Espera y recarga.');return action();
  });
}
export async function saveInventory(client:Client,storage:Storage,actor:string,operation:Operation,payload:Payload):Promise<Receipt>{
  return locked(actor,async()=>{
    if(readInventoryRequest(storage,actor))throw new Error('Recupera la solicitud pendiente antes de registrar otra.');
    const p:Pending={version:1,actor,request:crypto.randomUUID(),operation,payload:{...payload,actor_id:actor}};
    storage.setItem(inventoryRequestKey(actor),JSON.stringify(p));
    return execute(client,storage,p);
  });
}
export async function recoverInventory(client:Client,storage:Storage,actor:string,signal?:AbortSignal):Promise<Receipt|null>{
  return locked(actor,async()=>{const p=readInventoryRequest(storage,actor);return p?execute(client,storage,p,signal):null;});
}
