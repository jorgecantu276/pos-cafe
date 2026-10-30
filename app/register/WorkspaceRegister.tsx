'use client';

import { memo, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ProductPhoto from '@/components/ProductPhoto';
import { Keyboard, Minus, Plus, Search, X, Pencil, Trash2, Printer } from 'lucide-react';
import type { CatalogProduct } from '@/lib/pos-types';

type RegisterProps = ComponentProps<typeof import('./PrototypeRegister').default> & {
  orderNote: string; onOrderNote: (value: string) => void;
};
type CheckoutProps = ComponentProps<typeof import('./PrototypeRegister').PrototypeCheckout>;
type CustomizationProps = Omit<ComponentProps<typeof import('./PrototypeRegister').PrototypeCustomization>, 'onOption'> & {
  onOption: (name: string, stepIndex: number) => void;
  quantity?: number; onQuantity?: (value: number) => void; onRemove?: () => void;
};
const money = (value: number) => `$${value.toFixed(2)}`;
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');

export function WorkspaceDialog({ title, children, onClose, busy = false, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', ''); // DOM test environment.
    return () => { if (typeof node.close === 'function') node.close(); };
  }, []);
  return <dialog ref={ref} aria-label={title} className={`workspace-dialog ${className}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2>{title}</h2><button type="button" className="workspace-icon" aria-label={`Cerrar ${title}`} disabled={busy} onClick={onClose}><X size={22} /></button></header>
    {children}
  </dialog>;
}

export function WorkspaceKeyboard({ value, onChange, numeric = false, disabled = false, label }: {
  value: string; onChange: (value: string) => void; numeric?: boolean; disabled?: boolean; label?: string;
}) {
  const [symbols, setSymbols] = useState(false);
  const [upper, setUpper] = useState(false);
  const rows = numeric ? ['123', '456', '789'] : symbols ? ['1234567890', '!@#$%&*()-', '_+=[]{}:;', 'áéíóúü.,?/'] : ['1234567890', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm'];
  return <fieldset disabled={disabled} className={`workspace-keyboard ${numeric ? 'is-numeric' : ''}`} aria-label={numeric ? 'Teclado numérico' : 'Teclado en pantalla'}>
    {label && <legend>{label}</legend>}
    {rows.map(row => <div key={row}>{[...row].map(key => <button type="button" key={key} onClick={() => onChange(value + (upper ? key.toLocaleUpperCase('es') : key))}>{upper ? key.toLocaleUpperCase('es') : key}</button>)}</div>)}
    {numeric ? <div><button type="button" onClick={() => onChange(value + '.')}>.</button><button type="button" onClick={() => onChange(value + '0')}>0</button><button type="button" aria-label="Borrar último dígito" onClick={() => onChange(value.slice(0, -1))}>⌫</button></div>
      : <div><button type="button" aria-pressed={upper} onClick={() => setUpper(!upper)}>Mayús</button><button type="button" aria-pressed={symbols} onClick={() => setSymbols(!symbols)}>Símbolos</button><button type="button" className="workspace-space" onClick={() => onChange(value + ' ')}>Espacio</button><button type="button" onClick={() => onChange(value.slice(0, -1))}>Borrar</button></div>}
  </fieldset>;
}

const ProductButton = memo(function ProductButton({ product, disabled, onProduct }: {
  product: CatalogProduct; disabled: boolean; onProduct: RegisterProps['onProduct'];
}) {
  return <button className="workspace-product has-photo" disabled={disabled}
    onClick={() => onProduct(product)} aria-label={`${product.name}, ${money(Number(product.price))}`}>
    <ProductPhoto product={product} width={72} height={72} />
    <span className="workspace-product-copy"><strong>{product.name}</strong><span>{money(Number(product.price))}</span></span>
  </button>;
});

export default function WorkspaceRegister(p: RegisterProps) {
  const [panel, setPanel] = useState<'customer' | 'ticket' | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const [ticket, setTicket] = useState('');
  const catalogRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => {
    const active = p.products.filter(product => product.is_active);
    const groups = new Map<string, CatalogProduct[]>();
    const term = normalize(p.search.trim());
    for (const product of active) {
      const group = product.category || 'Otros';
      if (!normalize(product.name).includes(term)) continue;
      const rows = groups.get(group) ?? []; rows.push(product); groups.set(group, rows);
    }
    for (const rows of groups.values()) rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return [...groups].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [p.products, p.search]);
  const count = groups.reduce((sum, [, products]) => sum + products.length, 0);
  const filter = (value: string) => { p.onSearch(value); catalogRef.current?.scrollTo?.({ top: 0 }); };
  return <div className="workspace-register">
    <div className="workspace-notices">{p.notices}</div>
    <main className="workspace-body">
      <section className="workspace-catalog" aria-label="Menú de productos">
        <header className="workspace-simple-toolbar">
          {p.isAdmin ? <a href="/admin" className="workspace-admin-gateway">Administración</a> : <strong className="workspace-wordmark">Cariñito Mío</strong>}
          <div className="workspace-search"><Search size={20} /><input aria-label="Buscar producto" placeholder="Buscar producto" value={p.search} onChange={event => filter(event.target.value)} />
            {p.search && <button type="button" aria-label="Limpiar búsqueda" className="workspace-icon" onClick={() => filter('')}><X size={20} /></button>}
            <button type="button" className="workspace-icon" aria-label="Teclado de búsqueda" aria-pressed={keyboard} onClick={() => setKeyboard(!keyboard)}><Keyboard size={22} /></button>
          </div>
          <button type="button" aria-label="Tickets" className="workspace-icon" onClick={() => setPanel('ticket')}><Printer size={21} /></button>
          {p.onHandoff && <button type="button" className="workspace-handoff" onClick={p.onHandoff}>Cambiar cajero</button>}
          <button type="button" onClick={p.onCloseShift}>Terminar turno</button>
        </header>
        <div className="workspace-catalog-scroll" ref={catalogRef}>
          {groups.map(([name, products]) => <section key={name} className="workspace-product-group" aria-label={name}>
            <h2>{name}</h2><div className="workspace-product-grid">{products.map(product => <ProductButton key={product.id} product={product} disabled={p.disabled} onProduct={p.onProduct} />)}</div>
          </section>)}
          {!count && <p className="workspace-empty">{p.search ? 'No se encontraron productos.' : 'Cargando menú…'}</p>}
        </div>
        {keyboard && <div className="workspace-search-keys"><div><button type="button" onClick={() => setKeyboard(false)}>Listo</button></div><WorkspaceKeyboard value={p.search} onChange={filter} /></div>}
      </section>
      <aside className="workspace-order" aria-label="Orden actual"><header><h1>Orden actual</h1>
        <button type="button" className="workspace-icon" aria-label="Vaciar orden" disabled={!p.items.length || p.disabled} onClick={() => { if (confirm('¿Vaciar esta orden?')) p.onClear(); }}><Trash2 size={21} /></button></header>
        <button type="button" className="workspace-order-client" disabled={p.disabled} onClick={() => setPanel('customer')}>{p.customer?.name ?? 'Cliente (opcional)'}</button>
        <div className="workspace-order-lines">{p.items.map(item => <button type="button" className="workspace-order-line" key={item.id} aria-label={`Editar ${item.product.name}`} disabled={p.disabled} onClick={() => p.onEdit(item)}>
          <span><span className="workspace-line-count">{item.quantity} × </span>{item.product.name}</span><strong>{money(Math.round(item.quantity * item.product.price * 100) / 100)}</strong>
          {(item.product.displayExtras?.length || item.product.note) ? <small>{[...(item.product.displayExtras ?? []).map(extra => extra.name), item.product.note].filter(Boolean).join(' · ')}</small> : null}
        </button>)}{!p.items.length && <p className="workspace-empty">Toca un producto.</p>}</div>
        <footer className="workspace-order-footer"><div className="workspace-total"><span>Total</span><strong>{money(p.total)}</strong></div>
          <button type="button" className="workspace-pay" aria-label="Cobrar" disabled={!p.items.length || p.disabled} onClick={p.onCheckout}>Cobrar</button></footer>
      </aside>
    </main>
    {panel === 'ticket' && <WorkspaceDialog title="Reimprimir ticket" onClose={() => setPanel(null)} className="workspace-ticket-dialog"><div className="workspace-dialog-content"><label>Folio<input aria-label="Folio del ticket" inputMode="numeric" value={ticket} onChange={event => setTicket(event.target.value.replace(/\D/g, ''))} /></label><WorkspaceKeyboard numeric value={ticket} onChange={value => { if (/^\d*$/.test(value)) setTicket(value); }} />
      <div className="workspace-actions"><button type="button" onClick={() => p.onReprint()}>Último ticket</button><button type="button" className="workspace-primary" disabled={!ticket} onClick={() => p.onReprint(ticket)}>Buscar ticket</button></div></div></WorkspaceDialog>}
    {panel === 'customer' && <WorkspaceDialog title="Cliente" onClose={() => setPanel(null)}><div className="workspace-dialog-content"><div className="workspace-input-row"><input aria-label="Buscar cliente" placeholder="Nombre, código o WhatsApp" value={p.customerSearch} onChange={event => p.onCustomerSearch(event.target.value)} /><button type="button" onClick={() => { setPanel(null); p.onNewCustomer(); }}>Nuevo cliente</button></div>
      <div className="workspace-customer-results">{p.suggestions.map(customer => <button type="button" key={customer.id} onClick={() => { p.onCustomer(customer); setPanel(null); }}>{customer.name}<span>{customer.customer_code}</span></button>)}</div><WorkspaceKeyboard value={p.customerSearch} onChange={p.onCustomerSearch} />
      {p.customer && <button type="button" onClick={() => { p.onRemoveCustomer(); setPanel(null); }}>Quitar cliente de la orden</button>}</div></WorkspaceDialog>}
  </div>;
}

export function WorkspaceCustomization(p: CustomizationProps) {
  const [notes, setNotes] = useState(false);
  const choices = p.steps.map((step, index) => ({ step, index })).filter(({ step }) => step.id !== 'notes');
  return <WorkspaceDialog title={p.product.name} onClose={p.onClose} className="workspace-customization"><div className="workspace-dialog-content">
    {p.quantity !== undefined && <div className="workspace-edit-quantity"><span>Cantidad</span><button type="button" aria-label="Reducir cantidad" disabled={p.quantity <= 1} onClick={() => p.onQuantity?.(p.quantity! - 1)}><Minus size={22} /></button><strong>{p.quantity}</strong><button type="button" aria-label="Aumentar cantidad" onClick={() => p.onQuantity?.(p.quantity! + 1)}><Plus size={22} /></button></div>}
    {choices.map(({ step, index }) => <fieldset className="workspace-modifier-group" key={step.id}><legend>{step.title}</legend><div>{step.options.map(name => {
      const extra = p.dbExtras.find(extra => extra.name === name && extra.phase === step.id);
      const selected = p.extras.some(extra => extra.name === name && (!extra.phase || extra.phase === step.id));
      return <button type="button" key={name} aria-pressed={selected} onClick={() => p.onOption(name, index)}>{name}{Number(extra?.price) > 0 && <span>+{money(Number(extra?.price))}</span>}</button>;
    })}</div></fieldset>)}
    <button type="button" className="workspace-note-toggle" aria-expanded={notes} onClick={() => setNotes(!notes)}><Pencil size={17} />{p.note || 'Nota de preparación'}</button>
    {notes && <><input aria-label="Notas de preparación" value={p.note} maxLength={1000} onChange={event => p.onNote(event.target.value)} /><WorkspaceKeyboard value={p.note} onChange={value => p.onNote(value.slice(0, 1000))} /></>}
  </div><footer>{p.onRemove && <button type="button" onClick={p.onRemove}>Quitar</button>}<span className="workspace-custom-price">{money((p.quantity ?? 1) * (Number(p.product.basePrice ?? p.product.price) + p.extras.reduce((sum, extra) => sum + extra.price, 0)))}</span><button type="button" className="workspace-primary" onClick={p.onConfirm}>{p.quantity !== undefined ? 'Listo' : 'Agregar'}</button></footer></WorkspaceDialog>;
}

export function WorkspaceCheckout(p: CheckoutProps) {
  const [currency, setCurrency] = useState<'MXN' | 'USD'>('MXN');
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const [notes, setNotes] = useState(false);
  const cash = p.method === 'Efectivo' || p.method === 'Mixto';
  const parse = (value: string | number) => Number(String(value || 0).replace(',', '.'));
  const received = Math.round((parse(p.mxn) + parse(p.usd) * p.exchangeRate) * 100) / 100;
  const key = (value: string) => { if (/^\d{0,8}(?:\.\d{0,2})?$/.test(value)) (currency === 'MXN' ? p.onMXN : p.onUSD)(value); };
  return <WorkspaceDialog title="Cobrar" onClose={p.onClose} busy={p.busy} className="workspace-checkout"><div className="workspace-dialog-content"><div className="workspace-checkout-summary"><div><span>Total MXN</span><strong>{money(p.total)}</strong></div><select aria-label="Tipo de pedido" value={p.orderType} disabled={p.busy} onChange={event => p.onOrderType(event.target.value)}><option value="En Local">Para aquí</option><option value="Para Llevar">Para llevar</option></select></div>
    <div className="workspace-payment-methods" aria-label="Método de pago">{['Efectivo', 'Mixto', 'Tarjeta', 'Otro'].map(method => <button type="button" key={method} disabled={p.busy} aria-pressed={p.method === method} onClick={() => { p.onMethod(method); setCardConfirmed(false); setCurrency('MXN'); }}>{method === 'Mixto' ? 'MXN + USD' : method}</button>)}</div>
    {cash && <div className="workspace-cash-grid"><section><label>Recibido MXN<input aria-label="Recibido MXN" inputMode="decimal" disabled={p.busy} value={p.mxn} onFocus={() => setCurrency('MXN')} onChange={event => p.onMXN(event.target.value)} /></label>
      {p.method === 'Mixto' && <label>Recibido USD<input aria-label="Recibido USD" inputMode="decimal" disabled={p.busy} value={p.usd} onFocus={() => setCurrency('USD')} onChange={event => p.onUSD(event.target.value)} /></label>}
      {p.method === 'Efectivo' && <button type="button" disabled={p.busy} onClick={() => { p.onMXN(String(p.total)); p.onUSD(''); }}>Importe exacto</button>}
      {p.method === 'Mixto' && <p className="workspace-caption">1 USD = {p.exchangeRate} MXN</p>}
      <div className={`workspace-change ${received < p.total ? 'is-short' : ''}`}><span>{received < p.total ? 'Faltan MXN' : 'Cambio MXN'}</span><strong>{money(Math.abs(received - p.total))}</strong></div>
    </section><WorkspaceKeyboard numeric label={`Teclado ${currency}`} disabled={p.busy} value={String(currency === 'MXN' ? p.mxn : p.usd)} onChange={key} /></div>}
    {p.method === 'Tarjeta' && <label className="workspace-card-confirm"><input type="checkbox" disabled={p.busy} checked={cardConfirmed} onChange={event => setCardConfirmed(event.target.checked)} />Pago aprobado en la terminal</label>}
    {p.method === 'Otro' && <p className="workspace-caption">Registra la venta después de recibir el pago.</p>}
    <button type="button" className="workspace-note-toggle" aria-expanded={notes} disabled={p.busy} onClick={() => setNotes(!notes)}>{p.note || 'Nota de la orden'}</button>
    {notes && <><input aria-label="Notas de la orden" maxLength={1000} value={p.note} disabled={p.busy} onChange={event => p.onNote(event.target.value)} /><WorkspaceKeyboard disabled={p.busy} value={p.note} onChange={value => p.onNote(value.slice(0, 1000))} /></>}
  </div><footer><button type="button" className="workspace-primary" disabled={p.busy || p.insufficient || (p.method === 'Tarjeta' && !cardConfirmed)} onClick={p.onConfirm}>{p.busy ? 'Confirmando…' : 'Confirmar Pago'}</button></footer></WorkspaceDialog>;
}

export function WorkspaceOpening(p: {
  userName: string; isAdmin: boolean; denominations: number[]; counts: Record<number, number>;
  onCounts: (counts: Record<number, number>) => void; rate: string; onRate: (value: string) => void;
  dollars: number | ''; onDollars: (value: number | '') => void; total: number;
  busy: boolean; disabled: boolean; onOpen: () => void; onLogout: () => void;
}) {
  const [keyboard, setKeyboard] = useState<'dollars' | null>(null);
  const [dollarDraft, setDollarDraft] = useState(String(p.dollars));
  return <WorkspaceDialog title="Abrir caja" onClose={p.onLogout} busy={p.busy} className="workspace-opening"><div className="workspace-dialog-content">
    <div className="workspace-opening-access"><p className="workspace-caption">{p.userName}</p>{p.isAdmin && <a className="workspace-admin-gateway" href="/admin">Administración</a>}</div><div className="workspace-opening-fields"><div><p>Tipo de cambio guardado: 1 USD = {p.rate} MXN</p>{p.isAdmin && <a href="/admin/caja">Cambiar con la caja cerrada</a>}</div>
      <label>Dólares iniciales<div className="workspace-input-row"><input aria-label="Dólares iniciales" inputMode="decimal" disabled={p.busy} value={dollarDraft} onChange={event => { setDollarDraft(event.target.value); p.onDollars(event.target.value === '' ? '' : Number(event.target.value)); }} /><button type="button" aria-label="Teclado para dólares iniciales" disabled={p.busy} onClick={() => setKeyboard(keyboard === 'dollars' ? null : 'dollars')}><Keyboard size={22} /></button></div></label></div>
    {keyboard ? <div className="workspace-opening-keypad"><span>Dólares iniciales</span><WorkspaceKeyboard numeric disabled={p.busy} value={dollarDraft} onChange={value => {
      if (!/^\d{0,6}(?:\.\d{0,2})?$/.test(value)) return;
      setDollarDraft(value); p.onDollars(value === '' ? '' : Number(value));
    }} /><button type="button" onClick={() => setKeyboard(null)}>Listo</button></div> : <><h3>Efectivo inicial en pesos</h3><div className="workspace-denominations">{p.denominations.map(value => <label key={value}><strong>{money(value)}</strong><div><button type="button" aria-label={`Quitar una pieza de ${value} pesos`} disabled={p.busy || !p.counts[value]} onClick={() => p.onCounts({ ...p.counts, [value]: Math.max(0, p.counts[value] - 1) })}><Minus size={18} /></button><input type="number" min="0" step="1" aria-label={`Piezas de ${value} pesos`} disabled={p.busy} value={p.counts[value] || ''} onChange={event => p.onCounts({ ...p.counts, [value]: Number(event.target.value) })} /><button type="button" aria-label={`Agregar una pieza de ${value} pesos`} disabled={p.busy} onClick={() => p.onCounts({ ...p.counts, [value]: p.counts[value] + 1 })}><Plus size={18} /></button></div></label>)}</div></>}
  </div><footer><div><span>Fondo inicial MXN</span><strong>{money(p.total)}</strong></div><button type="button" className="workspace-primary" disabled={p.busy || p.disabled} onClick={p.onOpen}>{p.busy ? 'Abriendo…' : 'Abrir Turno'}</button></footer>
  </WorkspaceDialog>;
}
