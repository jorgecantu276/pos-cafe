'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {supabase} from '@/lib/supabase';
import {useResource} from '@/lib/use-resource';
import {errorMessage,type ExtraRow} from '@/lib/pos-types';
import {inventoryModes,stockQuantity,inventoryRequestKey,readInventoryRequest,recoverInventory,saveInventory,
  type InventoryProduct,type InventorySupply,type InventoryRecipe,type InventoryMovement,type InventoryMode} from '@/lib/inventory';
import LoadFailure from '@/app/LoadFailure';
import './inventory.css';

type Catalog={actor:string;products:InventoryProduct[];supplies:InventorySupply[];extras:ExtraRow[];recipes:InventoryRecipe[];movements:InventoryMovement[]};
const empty:Catalog={actor:'',products:[],supplies:[],extras:[],recipes:[],movements:[]};
export default function InventoryPage(){
  const [tab,setTab]=useState('stock'),[kind,setKind]=useState<'product'|'supply'>('product'),[id,setId]=useState('');
  const [search,setSearch]=useState(''),[operation,setOperation]=useState('entrada'),[quantity,setQuantity]=useState(''),[unit,setUnit]=useState('pza');
  const [reason,setReason]=useState(''),[mode,setMode]=useState<InventoryMode>('product'),[source,setSource]=useState(''),[units,setUnits]=useState('1');
  const [extraIds,setExtraIds]=useState<string[]>([]),[ingredients,setIngredients]=useState<{supply_id:string;quantity:string}[]>([]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failure,setFailure]=useState(''),[pending,setPending]=useState(false);
  const actorRef=useRef('');
  const router=useRouter();
  const load=useCallback(async(signal:AbortSignal)=>{
    const auth=await supabase.auth.getUser();if(auth.error||!auth.data.user)throw new Error('Inicia sesión para administrar inventario.');
    const all=async(table:string)=>{
      const rows:unknown[]=[];
      for(let start=0;;start+=1000){
        let query=supabase.from(table).select('*').order(table==='product_inventory_recipes'?'product_id':'id');
        if(table==='product_inventory_recipes')query=query.order('extra_ids');
        const r=await query.range(start,start+999).abortSignal(signal);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<1000)return rows;
      }
    };
    const [products,supplies,extras,recipes,history]=await Promise.all([all('products'),all('supplies'),all('extras'),all('product_inventory_recipes'),
      supabase.from('inventory_movements').select('*').order('created_at',{ascending:false}).order('id').limit(100).abortSignal(signal)]);
    if(history.error)throw history.error;
    return {actor:auth.data.user.id,products:products as InventoryProduct[],supplies:supplies as InventorySupply[],extras:extras as ExtraRow[],recipes:recipes as InventoryRecipe[],movements:history.data as InventoryMovement[]};
  },[]);
  const applied=useCallback((next:Catalog)=>{
    if(!actorRef.current&&new URLSearchParams(window.location.search).get('tab')==='recipes')setTab('recipes');
    actorRef.current=next.actor;
  },[]);
  const {data,loading,error,reload}=useResource(load,empty,applied);
  useEffect(()=>{actorRef.current=data.actor;const update=()=>{try{setPending(Boolean(data.actor&&readInventoryRequest(localStorage,data.actor)));}catch(e){setFailure(errorMessage(e));setPending(true);}};update();
    const listen=(e:StorageEvent)=>{if(e.key===null||e.key===inventoryRequestKey(data.actor))update();};window.addEventListener('storage',listen);
    return()=>window.removeEventListener('storage',listen);
  },[data.actor]);
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
      if(actorRef.current&&session?.user.id!==actorRef.current){actorRef.current='';router.replace('/login');router.refresh();}
    });return()=>subscription.unsubscribe();
  },[router]);
  const products=data.products,supplies=data.supplies.filter(s=>s.is_active);
  const selectedProduct=products.find(p=>p.id===id),selectedSupply=supplies.find(s=>s.id===id);
  const selected=kind==='product'?selectedProduct:selectedSupply;
  const reset=()=>{setId('');setQuantity('');setReason('');setFailure('');setExtraIds([]);setIngredients([]);};
  const select=(next:string)=>{
    setId(next);setQuantity('');setReason('');setFailure('');setExtraIds([]);
    const p=products.find(p=>p.id===next);const s=supplies.find(s=>s.id===next);
    setUnit(kind==='product'?'pza':s?.unit??'ml');
    if(p){setMode(p.inventory_mode);setSource(p.stock_product_id??'');setUnits(String(p.stock_units));
      setIngredients((data.recipes.find(r=>r.product_id===p.id&&!r.extra_ids.length)?.ingredients??[]).map(i=>({...i,quantity:String(i.quantity)})));}
  };
  const send=async(recovery=false)=>{
    const actor=data.actor;if(!actor||busy)return;setBusy(true);setFailure('');setMessage('');
    try{
      if(recovery)await recoverInventory(supabase,localStorage,actor);
      else{
        if(reason.trim().length<3)throw new Error('Escribe el motivo del cambio.');
        if(!selected)throw new Error('Selecciona un producto o insumo.');
        if(tab==='stock')await saveInventory(supabase,localStorage,actor,'movement',{kind,id,operation,quantity:stockQuantity(quantity,unit,kind==='supply'?selectedSupply?.unit??'':'pza'),unit:selectedSupply?.unit??'pza',revision:selected.inventory_revision,reason:reason.trim()});
        else if(tab==='policy')await saveInventory(supabase,localStorage,actor,'policy',{id,mode,source_id:source||null,units:Number(units),revision:selected.inventory_revision,reason:reason.trim()});
        else await saveInventory(supabase,localStorage,actor,'recipe',{id,revision:selected.inventory_revision,extra_ids:[...extraIds].sort(),
          ingredients:ingredients.map(i=>{const base=supplies.find(s=>s.id===i.supply_id)?.unit??'';return {supply_id:i.supply_id,quantity:stockQuantity(i.quantity,base,base)};}),reason:reason.trim()});
      }
      if(actorRef.current!==actor)return;
      setMessage(recovery?'Solicitud recuperada. Consulta las existencias actualizadas.':'Cambio guardado en el historial.');setQuantity('');setReason('');await reload();
    }catch(e){if(actorRef.current===actor){setFailure(errorMessage(e));await reload();}}
    finally{if(actorRef.current===actor){setBusy(false);try{setPending(Boolean(readInventoryRequest(localStorage,actor)));}catch{setPending(true);}}}
  };
  const chooseExtra=(extra:string,enabled:boolean)=>{
    const ids=(enabled?[...extraIds,extra]:extraIds.filter(x=>x!==extra)).sort();setExtraIds(ids);
    const stored=data.recipes.find(r=>r.product_id===id&&JSON.stringify([...r.extra_ids].sort())===JSON.stringify(ids));
    setIngredients((stored?.ingredients??[]).map(i=>({...i,quantity:String(i.quantity)})));
  };
  if(error)return <LoadFailure message={error} retry={reload}/>;
  if(loading&&!data.actor)return <p>Cargando inventario…</p>;
  return <div className="inventory-workspace">
    <header><h1>Inventario</h1><p>Entradas, merma, conteos y recetas confirmadas.</p></header>
    <nav aria-label="Inventario">{[['stock','Existencias'],['policy','Cómo se descuenta'],['recipes','Recetas'],['history','Historial']].map(([value,label])=>
      <button key={value} aria-pressed={tab===value} disabled={busy} onClick={()=>{setTab(value);setKind('product');reset();}}>{label}</button>)}<button disabled={busy||loading} onClick={()=>void reload()}>Actualizar</button></nav>
    {pending&&<div role="alert" className="inventory-warning"><p>Hay una solicitud sin confirmar. Recupérala antes de registrar otro cambio.</p><button disabled={busy} onClick={()=>void send(true)}>Recuperar la misma solicitud</button></div>}
    {failure&&<p role="alert" className="inventory-warning">{failure}</p>}{message&&<p role="status">{message}</p>}
    {tab==='history'?<div className="inventory-history"><p>Últimos 100 movimientos. Los saldos anteriores a esta actualización no tienen historial reconstruido.</p>
      <table><thead><tr><th>Fecha</th><th>Artículo</th><th>Movimiento</th><th>Antes → después</th><th>Motivo / venta</th></tr></thead><tbody>{data.movements.map(m=><tr key={m.id}>
        <td>{new Date(m.created_at).toLocaleString('es-MX',{timeZone:'America/Matamoros'})}</td><td>{m.target_name}</td><td>{m.operation}</td><td>{m.quantity_before} → {m.quantity_after} {m.unit}</td><td>{m.reason}{m.order_id&&` · ${m.order_id.slice(0,8)}`}</td></tr>)}</tbody></table>
      {!data.movements.length&&<p>Aún no hay movimientos.</p>}</div>:<div className="inventory-columns">
      <section><h2>{tab==='recipes'?'Producto y opciones':'Seleccionar artículo'}</h2>
        {tab==='stock'&&<div className="inventory-row"><button aria-pressed={kind==='product'} disabled={busy||pending} onClick={()=>{setKind('product');reset();}}>Productos</button><button aria-pressed={kind==='supply'} disabled={busy||pending} onClick={()=>{setKind('supply');reset();}}>Insumos</button></div>}
        <label>Buscar<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nombre del artículo"/></label>
        <div className="inventory-items">{(kind==='product'?products:supplies).filter(p=>p.name.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))).map(p=><button key={p.id} aria-pressed={id===p.id} disabled={busy||pending} onClick={()=>select(p.id)}><strong>{p.name}</strong>
          <span>{'stock' in p?inventoryModes[p.inventory_mode]:`${p.current_stock} ${p.unit}`}</span></button>)}</div>
      </section>
      <section><h2>{selected?.name??'Selecciona un artículo'}</h2>
        {selected&&<form onSubmit={e=>{e.preventDefault();void send();}}>
          {tab==='stock'&&<>
            {selectedProduct?.stock_product_id?<p>Comparte piezas con <strong>{products.find(p=>p.id===selectedProduct.stock_product_id)?.name??'otro producto'}</strong>. Registra entradas y conteos en ese producto.</p>:
              <p>Existencias actuales: <strong>{selectedProduct?.stock??selectedSupply?.current_stock} {selectedSupply?.unit??'pza'}</strong></p>}
            {selectedProduct&&['recipe','untracked'].includes(selectedProduct.inventory_mode)&&<p>No lleva conteo de piezas terminadas. {inventoryModes[selectedProduct.inventory_mode]}.</p>}
            <label>Movimiento<select value={operation} onChange={e=>{setOperation(e.target.value);setQuantity('');}}><option value="entrada">Entrada / producción recibida</option><option value="merma">Merma / salida sin venta</option><option value="conteo">Conteo físico</option></select></label>
            <label>{operation==='conteo'?'Cantidad contada':'Cantidad del movimiento'}<input required inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="0"/></label>
            <label>Unidad<select value={unit} onChange={e=>setUnit(e.target.value)}>{(kind==='product'||selectedSupply?.unit==='pza'?['pza']:selectedSupply?.unit==='ml'?['ml','lt','oz']:selectedSupply?.unit==='gr'?['gr','kg']:[selectedSupply?.unit??'ml']).map(u=><option key={u}>{u}</option>)}</select></label>
            <p>{operation==='conteo'?'El conteo reemplaza el saldo. Si hubo ventas desde que cargaste esta pantalla, actualiza y vuelve a contar.':'Las entradas y la merma se suman o restan al saldo al guardar. Una entrada de producto terminado no consume ingredientes de producción.'}</p>
          </>}
          {tab==='policy'&&<>
            <label>Descontar al vender<select value={mode} onChange={e=>{setMode(e.target.value as InventoryMode);setSource('');setUnits('1');}}>{Object.entries(inventoryModes).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
            <p>{mode==='untracked'?'Se puede vender sin descontar piezas ni ingredientes. No se informan existencias.':mode==='recipe'?'Solo descuenta ingredientes. Cada combinación elegida necesita una receta completa confirmada.':mode==='both'?'Descuenta piezas y la receta confirmada al vender. No descuentes de nuevo los mismos ingredientes al registrar producción.':'Descuenta piezas terminadas. No descuenta ingredientes.'}</p>
            {['product','both'].includes(mode)&&<><label>Piezas compartidas<select value={source} onChange={e=>{setSource(e.target.value);setUnits('1');}}><option value="">Existencias propias</option>{products.filter(p=>p.id!==id&&!p.stock_product_id&&['product','both'].includes(p.inventory_mode)).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {source&&<label>Piezas por presentación<input type="number" min="1" max="1000" step="1" value={units} onChange={e=>setUnits(e.target.value)}/></label>}
              <p>Ejemplo: Tortuguitas 5pz comparte Tortuguitas y descuenta 5 piezas. El paquete debe tener saldo propio cero antes de enlazarlo.</p></>}
          </>}
          {tab==='recipes'&&<>
            <p>Receta completa para estas opciones. Sin opciones seleccionadas se usa la receta base. No se sustituyen ingredientes por el nombre de una leche.</p>
            <fieldset><legend>Opciones de preparación</legend>{data.extras.filter(e=>e.active&&selectedProduct?.customizable&&selectedProduct.wizard_steps?.includes(e.phase)).map(e=><label className="inventory-check" key={e.id}><input type="checkbox" checked={extraIds.includes(e.id)} onChange={event=>chooseExtra(e.id,event.target.checked)}/>{e.phase}: {e.name}</label>)}</fieldset>
            {ingredients.map((line,index)=><div className="inventory-ingredient" key={index}>
              <label>Insumo<select required value={line.supply_id} onChange={e=>setIngredients(ingredients.map((v,i)=>i===index?{...v,supply_id:e.target.value}:v))}><option value="">Seleccionar</option>{supplies.map(s=><option key={s.id} value={s.id}>{s.name} ({s.unit})</option>)}</select></label>
              <label>Cantidad por venta<input required inputMode="decimal" value={line.quantity} onChange={e=>setIngredients(ingredients.map((v,i)=>i===index?{...v,quantity:e.target.value}:v))}/></label>
              <button type="button" onClick={()=>setIngredients(ingredients.filter((_,i)=>i!==index))}>Quitar</button>
            </div>)}
            <button type="button" onClick={()=>setIngredients([...ingredients,{supply_id:'',quantity:''}])}>Añadir insumo</button>
            <p>Guardar la receta no cambia el modo de inventario ni las existencias. Usa «Cómo se descuenta» para elegir si se aplicará.</p>
          </>}
          <label>Motivo<input required minLength={3} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Compra, producción, merma o validación del responsable"/></label>
          <button className="inventory-primary" disabled={busy||pending||(tab==='stock'&&!!selectedProduct&&(!!selectedProduct.stock_product_id||['recipe','untracked'].includes(selectedProduct.inventory_mode)))}>{busy?'Guardando…':'Guardar cambio'}</button>
        </form>}
      </section>
    </div>}
  </div>;
}
