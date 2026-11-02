'use client';

import PagerPicker from './PagerPicker';
import { productAvailable, productStockLabel } from '@/lib/pos-types';

import {useState,type ReactNode} from 'react';
import ProductPhoto from '@/components/ProductPhoto';
import type {CartItem,Product,CartExtra} from '../../store/useCartStore';
import type {CatalogProduct,Customer,ExtraRow,WizardStep} from '../../lib/pos-types';

const money=(v:number)=>`$${v.toFixed(2)}`;
export function TouchKeyboard({value,onChange,numeric=false}:{value:string;onChange:(v:string)=>void;numeric?:boolean}){
  const rows=numeric?['123','456','789','0.']:['1234567890','qwertyuiop','asdfghjklñ','zxcvbnmáéíóú'];
  return <div className={`touch-keys ${numeric?'numeric':''}`} aria-label="Teclado en pantalla">{rows.map(row=><div key={row}>{[...row].map(key=><button type="button" key={key} onClick={()=>onChange(value+key)}>{key}</button>)}</div>)}
    <div><button type="button" onClick={()=>onChange(value.slice(0,-1))}>Borrar</button>{!numeric&&<button type="button" onClick={()=>onChange(value+' ')}>Espacio</button>}<button type="button" onClick={()=>onChange('')}>Vaciar</button></div></div>;
}
function Sheet({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  return <div className="prototype-overlay"><section role="dialog" aria-modal="true" aria-label={title} className="prototype-sheet"><header><h2>{title}</h2><button onClick={onClose}>Cerrar</button></header>{children}</section></div>;
}
interface RegisterProps{
  products:CatalogProduct[];items:CartItem[];total:number;search:string;onSearch:(s:string)=>void;
  userName:string;isAdmin:boolean;disabled:boolean;onProduct:(p:Product)=>void;onEdit:(i:CartItem)=>void;
  onQuantity:(id:string,q:number)=>void;onRemove:(id:string)=>void;onClear:()=>void;onCheckout:()=>void;onCloseShift:()=>void;onHandoff?:()=>void;
  customer:Customer|null;customerSearch:string;onCustomerSearch:(s:string)=>void;suggestions:Customer[];onCustomer:(c:Customer)=>void;
  customerSearchError?:string;customerSearching?:boolean;onRetryCustomerSearch?:()=>void;
  onNewCustomer:()=>void;onRemoveCustomer:()=>void;orderType:string;onOrderType:(s:string)=>void;
  onReprint:(ticket?:string)=>void;notices:ReactNode;
  favoriteProductIds?:readonly string[];favoritesError?:string;recentTicketsContent?:ReactNode;
  favoritesLoading?:boolean;onRetryFavorites?:()=>void;
}
export default function PrototypeRegister(p:RegisterProps){
  const [category,setCategory]=useState('Todos'),[page,setPage]=useState(0),[selection,setSelection]=useState('');
  const [sheet,setSheet]=useState(''),[ticket,setTicket]=useState('');
  const categories=['Todos',...Array.from(new Set(p.products.filter(v=>v.is_active).map(v=>v.category||'Varios')))];
  const normalized=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  const filtered=p.products.filter(v=>v.is_active&&(category==='Todos'||category===v.category)&&normalized(v.name).includes(normalized(p.search)));
  const pages=Math.max(1,Math.ceil(filtered.length/6)),currentPage=Math.min(page,pages-1);
  const visible=filtered.slice(currentPage*6,currentPage*6+6),selected=p.items.find(i=>i.id===selection)??p.items.at(-1);
  const search=(s:string)=>{setPage(0);p.onSearch(s);};
  return <div className="prototype-register">
    <header className="prototype-topbar"><div className="prototype-brand"><span>C</span>Cariñito Mío</div><nav aria-label="Caja"><button aria-pressed={sheet!=='orders'} onClick={()=>setSheet('')}>Caja</button><button onClick={()=>setSheet('orders')}>Órdenes</button></nav>
      <div className="prototype-topright"><span>{p.userName}</span><button onClick={()=>{void document.documentElement.requestFullscreen?.().catch(()=>{});}}>Pantalla completa</button>{p.isAdmin&&<a href="/admin" target="_blank" rel="noreferrer">Administración</a>}{p.onHandoff&&<button onClick={p.onHandoff}>Cambiar cajero</button>}<button onClick={p.onCloseShift}>Terminar turno</button></div>
    </header>
    <div className="prototype-notices">{p.notices}</div>
    <main className="prototype-workspace">
      <section className="prototype-menu"><div className="prototype-heading"><h1>Menú</h1><button onClick={()=>setSheet('search')}>{p.search?`Buscar: ${p.search}`:'Buscar'}</button></div>
        <div className="prototype-categories" aria-label="Categorías">{categories.map(c=><button key={c} aria-pressed={category===c} onClick={()=>{setCategory(c);setPage(0);}}>{c}</button>)}</div>
        <div className="prototype-products">{visible.map(product=>{
          return <button className="prototype-product" key={product.id} onClick={()=>p.onProduct(product)} disabled={p.disabled || !productAvailable(product)}>
          <div className="prototype-photo"><ProductPhoto product={product} width={320} height={180}/></div>
          <div><h3>{product.name}</h3><span>{money(Number(product.price))}</span>{productStockLabel(product) && <small>{productStockLabel(product)}</small>}</div></button>;})}
          {!visible.length&&<p>No hay productos para esta búsqueda.</p>}</div>
        <footer className="prototype-pager"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>Anterior</button><span>Página {currentPage+1} de {pages} · {filtered.length} productos</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>Siguiente</button></footer>
      </section>
      <aside className="prototype-ticket"><div className="prototype-heading"><div><h2>Orden actual</h2><p>{p.customer?.name??'Toca un producto para modificarlo'}</p></div><button onClick={()=>setSheet('customer')}>{p.customer?'Cliente':'Nombre'}</button></div>
        <div className="prototype-service">{[['En Local','Para aquí'],['Para Llevar','Para llevar']].map(([v,label])=><button key={v} aria-pressed={p.orderType===v} disabled={p.disabled} onClick={()=>p.onOrderType(v)}>{label}</button>)}</div>
        <div className="prototype-lines">{p.items.map(item=><button key={item.id} className="prototype-line" aria-pressed={selected?.id===item.id} onClick={()=>setSelection(item.id)}>
          <strong>{item.quantity} × {item.product.name}</strong><strong>{money(item.quantity*item.product.price)}</strong><span>{[...(item.product.displayExtras??[]).map(e=>e.name),item.product.note].filter(Boolean).join(' · ')||'Sin extras'}</span></button>)}{!p.items.length&&<p className="prototype-empty">Selecciona un producto del menú.</p>}</div>
        <div className="prototype-line-actions"><button aria-label="Reducir cantidad" disabled={!selected||p.disabled} onClick={()=>selected&&p.onQuantity(selected.id,selected.quantity-1)}>−</button><span>{selected?.quantity??0}</span><button aria-label="Aumentar cantidad" disabled={!selected||p.disabled} onClick={()=>selected&&p.onQuantity(selected.id,selected.quantity+1)}>+</button><button disabled={!selected||p.disabled} onClick={()=>selected&&p.onEdit(selected)}>Personalizar</button></div>
        <div className="prototype-total"><span>Total MXN</span><strong>{money(p.total)}</strong></div>
        <div className="prototype-ticket-actions"><button disabled={!p.items.length||p.disabled} onClick={()=>{if(confirm('¿Vaciar la orden actual?'))p.onClear();}}>Limpiar</button><button disabled={!selected||p.disabled} onClick={()=>selected&&p.onRemove(selected.id)}>Quitar producto</button></div>
        <button className="prototype-pay" aria-label="Cobrar" disabled={!p.items.length||p.disabled} onClick={p.onCheckout}><span>Cobrar</span><strong>{money(p.total)}</strong></button>
      </aside>
    </main><footer className="prototype-status"><span>MXN · Requiere conexión</span><span>{p.disabled?'Revisa el estado de la orden':'Borrador automático en este navegador'}</span></footer>
    {sheet==='search'&&<Sheet title="Buscar producto" onClose={()=>setSheet('')}><input autoFocus aria-label="Buscar producto" value={p.search} onChange={e=>search(e.target.value)}/><TouchKeyboard value={p.search} onChange={search}/><button className="prototype-primary" onClick={()=>setSheet('')}>Ver productos</button></Sheet>}
    {sheet==='customer'&&<Sheet title="Cliente" onClose={()=>setSheet('')}><input autoFocus aria-label="Buscar cliente" placeholder="Teléfono del cliente" value={p.customerSearch} onChange={e=>p.onCustomerSearch(e.target.value)}/>
      {p.customerSearching?<p role="status">Buscando cliente…</p>:p.customerSearchError?<p role="alert">{p.customerSearchError} <button onClick={p.onRetryCustomerSearch}>Reintentar búsqueda</button></p>:p.customerSearch.trim().length>=2&&!p.suggestions.length?<p>No hay coincidencias. Revisa el teléfono antes de registrar.</p>:null}
      <div className="prototype-customer-results">{p.suggestions.map(c=><button key={c.id} onClick={()=>{p.onCustomer(c);setSheet('');}}>{c.name} · {c.phone || c.customer_code}</button>)}</div><TouchKeyboard value={p.customerSearch} onChange={p.onCustomerSearch}/>
      <div className="prototype-buttons"><button onClick={()=>{setSheet('');p.onNewCustomer();}}>Nuevo cliente</button>{p.customer&&<button onClick={()=>{p.onRemoveCustomer();setSheet('');}}>Quitar cliente</button>}</div></Sheet>}
    {sheet==='orders'&&<Sheet title="Tickets y órdenes" onClose={()=>setSheet('')}><label>Folio del ticket<input inputMode="numeric" value={ticket} onChange={e=>setTicket(e.target.value)} /></label><TouchKeyboard value={ticket} onChange={setTicket} numeric/>
      <div className="prototype-buttons"><button onClick={()=>p.onReprint(ticket)}>Buscar e imprimir ticket</button><button onClick={()=>p.onReprint()}>Reimprimir último ticket</button>{p.isAdmin&&<a href="/admin/ventas" target="_blank" rel="noreferrer">Historial de ventas</a>}</div></Sheet>}
  </div>;
}

export function PrototypeCustomization({product,steps,index,extras,dbExtras,note,onNote,onStep,onOption,onConfirm,onClose}:{
  product:Product;steps:WizardStep[];index:number;extras:CartExtra[];dbExtras:ExtraRow[];note:string;onNote:(s:string)=>void;
  onStep:(n:number)=>void;onOption:(s:string)=>void;onConfirm:()=>void;onClose:()=>void;
}){
  const step=steps[index];
  return <Sheet title={product.name} onClose={onClose}><div className="prototype-modifier-tabs">{steps.map((s,i)=><button key={s.id} aria-pressed={i===index} onClick={()=>onStep(i)}>{s.title}</button>)}</div>
    {step.id==='notes'?<><textarea aria-label="Notas de preparación" value={note} onChange={e=>onNote(e.target.value)} maxLength={1000}/><TouchKeyboard value={note} onChange={onNote}/></>:<div className="prototype-options">{step.options.map(name=>{
      const extra=dbExtras.find(e=>e.name===name&&e.phase===step.id);return <button key={name} aria-pressed={extras.some(e=>e.name===name&&(!e.phase||e.phase===step.id))} onClick={()=>onOption(name)}>{name}{Number(extra?.price)>0&&` +${money(Number(extra?.price))}`}</button>;
    })}</div>}
    <div className="prototype-buttons"><button disabled={index===0} onClick={()=>onStep(index-1)}>Anterior</button>{index<steps.length-1&&<button onClick={()=>onStep(index+1)}>Siguiente</button>}<button className="prototype-primary" onClick={onConfirm}>Confirmar Producto</button></div>
  </Sheet>;
}

export function PrototypeCheckout({total,method,mxn,usd,exchangeRate,orderType,note,busy,insufficient,onMethod,onMXN,onUSD,onOrderType,onNote,onConfirm,onClose,pagerNumber,onPagerNumber,clipEnabled}:{
  total:number;method:string;mxn:string|number;usd:string|number;exchangeRate:number;orderType:string;note:string;busy:boolean;insufficient:boolean;
  onMethod:(s:string)=>void;onMXN:(s:string)=>void;onUSD:(s:string)=>void;onOrderType:(s:string)=>void;onNote:(s:string)=>void;onConfirm:()=>void;onClose:()=>void;
  pagerNumber?:number|null;onPagerNumber?:(value:number|null)=>void;clipEnabled?:boolean;
}){
  const [currency,setCurrency]=useState<'MXN'|'USD'>('MXN'),[confirmed,setConfirmed]=useState(false),[notes,setNotes]=useState(false);
  const cash=method==='Efectivo'||method==='Mixto',received=Number(mxn||0)+Number(usd||0)*exchangeRate;
  const key=(value:string)=>{if(!/^\d{0,8}(?:\.\d{0,2})?$/.test(value))return;(currency==='MXN'?onMXN:onUSD)(value);};
  return <Sheet title="Cobrar orden" onClose={()=>{if(!busy)onClose();}}><div className="prototype-checkout-total"><span>Total MXN</span><strong>{money(total)}</strong></div>
    <div className="prototype-checkout-grid"><section>
      <div className="prototype-service">{['En Local','Para Llevar'].map(t=><button key={t} disabled={busy} aria-pressed={orderType===t} onClick={()=>onOrderType(t)}>{t==='En Local'?'Para aquí':'Para llevar'}</button>)}</div>
      <button disabled={busy} onClick={()=>setNotes(!notes)}>Notas de la orden{note?' · añadidas':''}</button>
      {notes&&<><textarea aria-label="Notas de la orden" disabled={busy} value={note} onChange={e=>onNote(e.target.value)} maxLength={1000}/><TouchKeyboard value={note} onChange={onNote}/></>}
      <div className="prototype-options">{['Efectivo','Mixto','Tarjeta','Otro'].map(m=><button key={m} disabled={busy} aria-pressed={method===m} onClick={()=>{onMethod(m);setConfirmed(false);}}>{m==='Mixto'?'MXN + USD':m}</button>)}</div>
      {method==='Tarjeta'&&!clipEnabled&&<label className="prototype-card-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmé el cobro aprobado en la terminal.</label>}
      {onPagerNumber&&<PagerPicker value={pagerNumber??null} onChange={onPagerNumber} disabled={busy}/>}
      {method==='Otro'&&<p>Confirma el pago por separado antes de registrar la venta.</p>}
      {cash&&<><div className="prototype-service">{['MXN','USD'].map(c=><button key={c} disabled={busy} aria-pressed={currency===c} onClick={()=>setCurrency(c as 'MXN'|'USD')}>{c}</button>)}</div>
        <label>Recibido MXN<input inputMode="decimal" disabled={busy} value={mxn} onFocus={()=>setCurrency('MXN')} onChange={e=>onMXN(e.target.value)}/></label><label>Recibido USD<input inputMode="decimal" disabled={busy} value={usd} onFocus={()=>setCurrency('USD')} onChange={e=>onUSD(e.target.value)}/></label>
        <p>Tipo de cambio: {exchangeRate} MXN / USD</p><p>{received>=total?`Cambio MXN: ${money(received-total)}`:`Faltan MXN: ${money(total-received)}`}</p></>}
    </section>{cash&&!notes&&<section><fieldset disabled={busy}><legend>Teclado {currency}</legend><TouchKeyboard value={String(currency==='MXN'?mxn:usd)} onChange={key} numeric/></fieldset><button disabled={busy} onClick={()=>{onMXN(String(total));onUSD('');}}>Importe exacto en MXN</button></section>}</div>
    <button className="prototype-primary" disabled={busy||insufficient||(method==='Tarjeta'&&!clipEnabled&&!confirmed)} onClick={onConfirm}>{busy?'Confirmando…':method==='Tarjeta'&&clipEnabled?'Enviar a CLIP':'Confirmar Pago'}</button>
  </Sheet>;
}
