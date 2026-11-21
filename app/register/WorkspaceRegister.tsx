'use client';
import { posProfile } from '@/lib/pos-profile';
import { receivedCashMXN, usdCashQuote } from '@/lib/usd-cash';

import { memo, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import ProductPhoto from '@/components/ProductPhoto';
import PagerPicker from './PagerPicker';
import { Keyboard, Minus, Plus, Search, X, Pencil, Trash2, Printer, UserRound, ChevronRight, Coffee, Settings2, ArrowRight, Sparkles } from 'lucide-react';
import { isSmoothie, productAvailable, productStockLabel, validPagerNumber } from '@/lib/pos-types';
import { favoriteMenuCards, matchesMenuCard, menuCardAvailable, menuCardPrice, menuCards, normalizeMenuText, type DrinkSize, type MenuCard } from '@/lib/menu-cards';

type RegisterProps = ComponentProps<typeof import('./PrototypeRegister').default> & {
  orderNote: string; onOrderNote: (value: string) => void;
  catalogLoading?: boolean;
  weeklySpecialId?: string | null;
  smoothies?: boolean;
  favoriteProductIds?: readonly string[]; favoritesError?: string; favoritesLoading?: boolean; onRetryFavorites?: () => void; recentTicketsContent?: ReactNode;
};
type CheckoutProps = ComponentProps<typeof import('./PrototypeRegister').PrototypeCheckout> & { smoothies?: boolean };
type CustomizationProps = Omit<ComponentProps<typeof import('./PrototypeRegister').PrototypeCustomization>, 'onOption' | 'product'> & {
  product: ComponentProps<typeof import('./PrototypeRegister').PrototypeCustomization>['product'] | null;
  family?: MenuCard;
  onVariant?: (id: string | null) => void;
  smoothies?: MenuCard[];
  onSmoothie?: (id: string) => void;
  onOption: (name: string, stepIndex: number) => void;
  quantity?: number; onQuantity?: (value: number) => void; onRemove?: () => void;
};
const money = (value: number) => `$${value.toFixed(2)}`;

function SmoothieCup({ name, creamy = false, toppings = false }: { name: string; creamy?: boolean; toppings?: boolean }) {
  const flavor = normalizeMenuText(name);
  const tone = /\b(frutos rojos|fresa|mora|frambuesa|arandano|pitaya|remolacha|betabel)\b/.test(flavor) ? 'berry'
    : /\b(verde|espinaca|pepino|kiwi|manzana verde|aguacate|matcha)\b/.test(flavor) ? 'green'
    : /\b(cacao|chocolate|cafe)\b/.test(flavor) ? 'cocoa'
    : /\b(mango|maracuya|papaya|durazno|naranja)\b/.test(flavor) ? 'mango'
    : /\b(coco|pina|platano|vainilla)\b/.test(flavor) ? 'cream' : 'violet';
  return <span className="smoothie-cup" data-tone={tone} data-creamy={creamy} data-toppings={toppings} aria-hidden="true">
    <span className="smoothie-straw" /><span className="smoothie-lid" />
    <span className="smoothie-glass"><Sparkles size={17} /></span>
  </span>;
}

export function WorkspaceDialog({ title, children, onClose, busy = false, className = '', headerAccessory }: {
  title: string; children: ReactNode; onClose?: () => void; busy?: boolean; className?: string; headerAccessory?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof node.showModal === 'function') node.showModal();
    else node.setAttribute('open', ''); // DOM test environment.
    return () => { if (typeof node.close === 'function') node.close(); };
  }, []);
  return <dialog ref={ref} aria-label={title} className={`workspace-dialog ${className}`} onCancel={event => { event.preventDefault(); if (!busy) onClose?.(); }}>
    <header>{headerAccessory ? <div className="workspace-dialog-heading"><h2>{title}</h2>{headerAccessory}</div> : <h2>{title}</h2>}{onClose && <button type="button" className="workspace-icon" aria-label={`Cerrar ${title}`} disabled={busy} onClick={onClose}><X size={22} /></button>}</header>
    {children}
  </dialog>;
}

export function WorkspaceKeyboard({ value, onChange, numeric = false, integer = false, disabled = false, label }: {
  value: string; onChange: (value: string) => void; numeric?: boolean; integer?: boolean; disabled?: boolean; label?: string;
}) {
  const [symbols, setSymbols] = useState(false);
  const [upper, setUpper] = useState(false);
  const rows = numeric ? ['123', '456', '789'] : symbols ? ['1234567890', '!@#$%&*()-', '_+=[]{}:;', 'áéíóúü.,?/'] : ['1234567890', 'qwertyuiop', 'asdfghjklñ', 'zxcvbnm'];
  return <fieldset disabled={disabled} className={`workspace-keyboard ${numeric ? 'is-numeric' : ''}`} aria-label={numeric ? 'Teclado numérico' : 'Teclado en pantalla'}>
    {label && <legend>{label}</legend>}
    {rows.map(row => <div key={row}>{[...row].map(key => <button type="button" key={key} onClick={() => onChange(value + (upper ? key.toLocaleUpperCase('es') : key))}>{upper ? key.toLocaleUpperCase('es') : key}</button>)}</div>)}
    {numeric ? <div><button type="button" disabled={integer} onClick={() => onChange(value + '.')}>.</button><button type="button" onClick={() => onChange(value + '0')}>0</button><button type="button" aria-label="Borrar último dígito" onClick={() => onChange(value.slice(0, -1))}>⌫</button></div>
      : <div><button type="button" aria-pressed={upper} onClick={() => setUpper(!upper)}>Mayús</button><button type="button" aria-pressed={symbols} onClick={() => setSymbols(!symbols)}>Símbolos</button><button type="button" className="workspace-space" onClick={() => onChange(value + ' ')}>Espacio</button><button type="button" onClick={() => onChange(value.slice(0, -1))}>Borrar</button></div>}
  </fieldset>;
}

const ProductButton = memo(function ProductButton({ product, disabled, onProduct }: {
  product: MenuCard; disabled: boolean; onProduct: RegisterProps['onProduct'];
}) {
  return <button className="workspace-product has-photo" disabled={disabled || !menuCardAvailable(product)}
    onClick={() => onProduct(product)} title={product.name} aria-label={`${product.name}, ${menuCardPrice(product)}`}>
    {(posProfile.id === 'smoothies' && isSmoothie(product)) ? <span className="smoothie-product-art"><SmoothieCup name={product.name} />
      {product.image_url && <ProductPhoto product={product} width={56} height={56} illustrativeFallback={false} />}
    </span> : <ProductPhoto product={product} width={56} height={56} />}
    <span className="workspace-product-copy"><strong>{product.name}</strong><span>{menuCardPrice(product)}</span>{productStockLabel(product) && <small>{productStockLabel(product)}</small>}</span>
  </button>;
});

export default function WorkspaceRegister(p: RegisterProps) {
  const [panel, setPanel] = useState<'customer' | 'ticket' | 'note' | null>(null);
  const [quantityItemId, setQuantityItemId] = useState<string | null>(null);
  const [noteKeyboard, setNoteKeyboard] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [ticket, setTicket] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const cards = useMemo(() => menuCards(p.products), [p.products]);
  const favorites = useMemo(() => favoriteMenuCards(cards, p.favoriteProductIds ?? []), [cards, p.favoriteProductIds]);
  const categories = useMemo(() => [...new Set(p.products.filter(product => product.is_active)
    .map(product => product.category || 'Otros'))].sort((a, b) => a.localeCompare(b, 'es')), [p.products]);
  const selectedCategory = category !== null && categories.includes(category) ? category : null;
  const special = cards.find(product => product.id === p.weeklySpecialId && (posProfile.id === 'smoothies' && isSmoothie(product)) && menuCardAvailable(product));
  const visibleSpecial = !p.search.trim() && (selectedCategory === null || selectedCategory === special?.category) ? special : undefined;
  const groups = useMemo(() => {
    const groups = new Map<string, MenuCard[]>();
    for (const product of cards) {
      const group = product.category || 'Otros';
      if (selectedCategory !== null && group !== selectedCategory) continue;
      if (!matchesMenuCard(product, p.search)) continue;
      const rows = groups.get(group) ?? []; rows.push(product); groups.set(group, rows);
    }
    for (const rows of groups.values()) rows.sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return [...groups].sort(([a], [b]) => a.localeCompare(b, 'es'));
  }, [cards, p.search, selectedCategory]);
  const count = groups.reduce((sum, [, products]) => sum + products.length, 0);
  const drinkCount = p.items.reduce((sum, item) => sum + item.quantity, 0);
  const canCharge = p.smoothies || p.phoneOrder || validPagerNumber(p.pagerNumber);
  const quantityItem = p.items.find(item => item.id === quantityItemId);
  const filter = (value: string) => { p.onSearch(value); catalogRef.current?.scrollTo?.({ top: 0 }); };
  const chooseCategory = (value: string | null) => { setCategory(value); catalogRef.current?.scrollTo?.({ top: 0 }); };
  return <div className={`workspace-register${p.smoothies ? ' smoothie-counter' : ''}`}>
    <div className="workspace-notices">{p.notices}</div>
    <main className="workspace-body">
      <section className="workspace-catalog" aria-label="Menú de productos">
        <header className="workspace-simple-toolbar">
          <div className="workspace-identity"><span className="workspace-brand-icon" aria-hidden="true">{p.smoothies ? <Sparkles size={23} /> : <Coffee size={23} />}</span><div><strong className="workspace-wordmark">{posProfile.brand}</strong><span className="workspace-cashier"><span aria-hidden="true" />{p.userName}</span></div></div>
          <div className="workspace-shift-actions">{p.smoothies && p.isAdmin && <a href="/admin/recetario" className="workspace-admin-gateway">Recetario</a>}{p.isAdmin && <a href="/admin" className="workspace-admin-gateway"><Settings2 size={18} />Administración</a>}
            {p.onHandoff && <button type="button" className="workspace-handoff" onClick={p.onHandoff}>Cambiar cajero</button>}
            <button type="button" onClick={p.onCloseShift}>Terminar turno</button></div>
        </header>
        <div className="workspace-menu-heading"><div><h1>Menú</h1><span>{count} productos</span></div>
          <div className="workspace-search"><Search size={20} /><input aria-label="Buscar producto" placeholder="Buscar producto" value={p.search} onChange={event => filter(event.target.value)} />
            {p.search && <button type="button" aria-label="Limpiar búsqueda" className="workspace-icon" onClick={() => filter('')}><X size={20} /></button>}
            <button type="button" className="workspace-icon" aria-label="Teclado de búsqueda" aria-pressed={keyboard} onClick={() => setKeyboard(!keyboard)}><Keyboard size={22} /></button>
          </div>
          {p.onPhoneOrders&&<button type="button" className="workspace-tickets" onClick={p.onPhoneOrders}>Pedidos por cobrar</button>}<button type="button" aria-label="Tickets" className="workspace-tickets" onClick={() => setPanel('ticket')}><Printer size={20} /><span>Tickets</span></button>
        </div>
        <nav className="workspace-categories" aria-label="Categorías del menú"><button type="button" aria-pressed={selectedCategory === null} onClick={() => chooseCategory(null)}>Todos</button>{categories.map(name => <button type="button" key={name} aria-pressed={selectedCategory === name} onClick={() => chooseCategory(name)}>{name}</button>)}{p.isAdmin && !p.search.trim() && !favorites.length && !p.favoritesLoading && !p.favoritesError && <a href="/admin/favoritos">Elegir favoritos</a>}</nav>
        <div className="workspace-catalog-scroll" ref={catalogRef} role="region" aria-label="Productos del menú" tabIndex={0}>
          {visibleSpecial && <button type="button" className="smoothie-special" disabled={p.disabled}
            aria-label={`Especial de la semana: ${visibleSpecial.name}, ${menuCardPrice(visibleSpecial)}`}
            onClick={() => p.onProduct(visibleSpecial)}>
            <div className="smoothie-special-copy">
              <span><Sparkles size={16} aria-hidden="true" />Especial de la semana</span>
              <strong>{visibleSpecial.name}</strong>
              <span>{menuCardPrice(visibleSpecial)} MXN</span>
            </div>
            <SmoothieCup name={visibleSpecial.name} />
          </button>}
          {!p.search.trim() && selectedCategory === null && (favorites.length > 0 || p.favoritesError || p.favoritesLoading) && <section className="workspace-product-group workspace-favorites-group" aria-label="Favoritos" aria-busy={p.favoritesLoading || undefined}>{favorites.length > 0 && <div className="workspace-favorites-heading"><h2>Favoritos</h2>{p.isAdmin && <a href="/admin/favoritos">Elegir favoritos</a>}</div>}
            {p.favoritesLoading && <p role="status" className="workspace-favorites-message">Cargando favoritos…</p>}
            {p.favoritesError && <div role="status" className="workspace-favorites-message"><span>{p.favoritesError}</span>{p.onRetryFavorites && <button type="button" disabled={p.favoritesLoading} onClick={p.onRetryFavorites}>Reintentar favoritos</button>}</div>}
            {favorites.length > 0 && <div className="workspace-product-grid">{favorites.map(product => <ProductButton key={product.id} product={product} disabled={p.disabled} onProduct={p.onProduct}/>)}</div>}
          </section>}
          {groups.map(([name, products]) => <section key={name} className="workspace-product-group" aria-label={name}>
            <h2>{name}</h2><div className="workspace-product-grid">{products.map(product => <ProductButton key={product.id} product={product} disabled={p.disabled} onProduct={p.onProduct} />)}</div>
          </section>)}
          {!count && <p className="workspace-empty" role="status">{p.catalogLoading ? 'Cargando menú…' : p.search ? 'No se encontraron productos. Prueba otro nombre o categoría.' : 'No hay productos disponibles.'}</p>}
        </div>
        {keyboard && <div className="workspace-search-keys"><div><button type="button" onClick={() => setKeyboard(false)}>Listo</button></div><WorkspaceKeyboard value={p.search} onChange={filter} /></div>}
      </section>
      <aside className="workspace-order" aria-label="Orden actual"><header><h1>Orden actual</h1>
        <span className="workspace-order-count" key={drinkCount}>{drinkCount}</span><button type="button" className="workspace-icon" aria-label="Vaciar orden" disabled={!p.items.length || p.disabled} onClick={() => { if (confirm('¿Vaciar esta orden?')) p.onClear(); }}><Trash2 size={20} /></button></header>
        <div className="workspace-order-tools">
          <button type="button" className="workspace-order-client" disabled={p.disabled} onClick={() => setPanel('customer')}><UserRound size={19} /><span>{p.customer?.name ?? 'Cliente (opcional)'}</span><ChevronRight size={18} /></button>
          <button type="button" className="workspace-order-note" aria-label={p.orderNote.trim() ? 'Ver nota de la orden' : 'Nota de la orden'} disabled={p.disabled || !p.items.length} onClick={() => { setNoteKeyboard(false); setPanel('note'); }}><Pencil size={16} aria-hidden="true" />{p.orderNote.trim() ? 'Ver nota' : 'Nota'}</button>
        </div>
        <div className="workspace-order-lines" role="region" aria-label="Artículos del pedido" tabIndex={0}>{p.items.map(item => <div className="workspace-order-row" key={item.id}>
          {p.smoothies ? <div className="smoothie-line-quantity" role="group" aria-label={`Cantidad de ${item.product.name}`}>
            <button type="button" aria-label={`Reducir cantidad de ${item.product.name}`} disabled={p.disabled || item.quantity <= 1} onClick={() => p.onQuantity(item.id, item.quantity - 1)}><Minus size={16} /></button>
            <output>{item.quantity}</output>
            <button type="button" aria-label={`Aumentar cantidad de ${item.product.name}`} disabled={p.disabled} onClick={() => p.onQuantity(item.id, item.quantity + 1)}><Plus size={16} /></button>
          </div> : <button type="button" className="workspace-line-count" aria-label={`Cambiar cantidad de ${item.product.name}, ${item.quantity} en la orden`} disabled={p.disabled} onClick={() => setQuantityItemId(item.id)}>{item.quantity} ×</button>}
          <button type="button" className="workspace-order-line" aria-label={`Editar ${item.product.name}`} disabled={p.disabled} onClick={() => p.onEdit(item)}>
            <span>{item.product.name}</span><strong>{money(Math.round(item.quantity * item.product.price * 100) / 100)}</strong><Pencil className="workspace-line-edit" size={16} aria-hidden="true" />
            {(item.product.displayExtras?.length || item.product.note) ? <small>{[...(item.product.displayExtras ?? []).map(extra => extra.name), item.product.note].filter(Boolean).join(' · ')}</small> : null}
          </button>
        </div>)}{!p.items.length && <div className="workspace-empty-order">{p.smoothies ? <SmoothieCup name="Mango" /> : <Coffee size={34} aria-hidden="true" />}<strong>Orden vacía</strong><p>{p.smoothies ? 'Elige un smoothie del menú.' : 'Toca un producto del menú.'}</p></div>}</div>
        <footer className="workspace-order-footer">{p.onPagerNumber&&<PagerPicker value={p.pagerNumber??null} onChange={p.onPagerNumber} disabled={p.disabled} phoneOrder={p.phoneOrder} onPhoneOrder={p.onPhoneOrder}/>}
          {!canCharge&&p.items.length>0&&<p className="pos-pager-required-note">Elige un control para cobrar.</p>}
          <div className="workspace-total"><span>Total <small>MXN</small></span><strong aria-live="polite">{money(p.total)}</strong></div>
          <button type="button" className="workspace-pay" aria-label={p.phoneOrder?'Guardar pedido':'Cobrar'} disabled={!p.items.length || p.disabled || !canCharge} onClick={()=>{if(canCharge)p.onCheckout();}}>{p.phoneOrder?'Guardar pedido':'Cobrar'}<ArrowRight size={22} aria-hidden="true" /></button></footer>
      </aside>
    </main>
    {panel === 'ticket' && <WorkspaceDialog title="Reimprimir ticket" onClose={() => setPanel(null)} className="workspace-ticket-dialog"><div className="workspace-dialog-content">{p.recentTicketsContent}<label>Folio<input aria-label="Folio del ticket" inputMode="numeric" value={ticket} onChange={event => setTicket(event.target.value.replace(/\D/g, ''))} /></label><WorkspaceKeyboard numeric value={ticket} onChange={value => { if (/^\d*$/.test(value)) setTicket(value); }} />
      <div className="workspace-actions"><button type="button" onClick={() => p.onReprint()}>Reimprimir último</button><button type="button" className="workspace-primary" disabled={!ticket} onClick={() => p.onReprint(ticket)}>Reimprimir folio</button></div></div></WorkspaceDialog>}
    {panel === 'customer' && <WorkspaceDialog title="Cliente" onClose={() => setPanel(null)}><div className="workspace-dialog-content"><div className="workspace-input-row"><input aria-label="Buscar cliente" placeholder="Teléfono del cliente" value={p.customerSearch} onChange={event => p.onCustomerSearch(event.target.value)} /><button type="button" onClick={() => { setPanel(null); p.onNewCustomer(); }}>Nuevo cliente</button></div>
      {p.customerSearching?<p role="status">Buscando cliente…</p>:p.customerSearchError?<p role="alert">{p.customerSearchError} <button type="button" onClick={p.onRetryCustomerSearch}>Reintentar búsqueda</button></p>:p.customerSearch.trim().length>=2&&!p.suggestions.length?<p>No encontramos ese teléfono. Revísalo o agrega un cliente.</p>:null}
      <div className="workspace-customer-results">{p.suggestions.map(customer => <button type="button" key={customer.id} onClick={() => { p.onCustomer(customer); setPanel(null); }}>{customer.name}<span>{customer.phone || customer.customer_code}</span></button>)}</div><WorkspaceKeyboard value={p.customerSearch} onChange={p.onCustomerSearch} />
      {p.customer && <button type="button" onClick={() => { p.onRemoveCustomer(); setPanel(null); }}>Quitar cliente de la orden</button>}</div></WorkspaceDialog>}
    {quantityItem && <WorkspaceDialog title={`Cantidad de ${quantityItem.product.name}`} onClose={() => setQuantityItemId(null)} className="workspace-quantity-dialog">
      <div className="workspace-dialog-content workspace-edit-quantity">
        <button type="button" aria-label="Reducir cantidad" disabled={p.disabled || quantityItem.quantity <= 1} onClick={() => p.onQuantity(quantityItem.id, quantityItem.quantity - 1)}><Minus size={22} /></button>
        <strong aria-live="polite">{quantityItem.quantity}</strong>
        <button type="button" aria-label="Aumentar cantidad" disabled={p.disabled} onClick={() => p.onQuantity(quantityItem.id, quantityItem.quantity + 1)}><Plus size={22} /></button>
      </div>
      <footer><button type="button" className="workspace-primary" onClick={() => setQuantityItemId(null)}>Listo</button></footer>
    </WorkspaceDialog>}
    {panel === 'note' && <WorkspaceDialog title="Nota de la orden" onClose={() => setPanel(null)} className="workspace-order-note-dialog">
      <div className="workspace-dialog-content">
        <label htmlFor="workspace-order-note">Nota para el pedido completo</label>
        <textarea id="workspace-order-note" rows={3} maxLength={1000} value={p.orderNote} disabled={p.disabled} onChange={event => p.onOrderNote(event.target.value)} />
        <button type="button" aria-expanded={noteKeyboard} disabled={p.disabled} onClick={() => setNoteKeyboard(!noteKeyboard)}><Keyboard size={18} />{noteKeyboard ? 'Ocultar teclado' : 'Teclado'}</button>
        {noteKeyboard && <WorkspaceKeyboard disabled={p.disabled} value={p.orderNote} onChange={value => p.onOrderNote(value.slice(0, 1000))} />}
      </div>
      <footer><button type="button" className="workspace-primary" onClick={() => setPanel(null)}>Listo</button></footer>
    </WorkspaceDialog>}
  </div>;
}

type PreparationOption = { id: string; label: string; detail?: string; selected: boolean; disabled?: boolean };

function PreparationChoices({ title, searchLabel, options, onChoose }: {
  title: string; searchLabel: string; options: PreparationOption[]; onChoose: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const term = normalizeMenuText(search);
  const visible = options.filter(option => normalizeMenuText(option.label).includes(term));
  return <fieldset className={`workspace-modifier-group${options.length >= 7 ? ' workspace-options-many' : ''}`}>
    <legend>{title}</legend>
    {options.length >= 9 && <label className="workspace-options-search">
      <Search size={18} aria-hidden="true" />
      <input type="search" aria-label={searchLabel} placeholder={searchLabel} value={search} onChange={event => setSearch(event.target.value)} />
    </label>}
    <div>{visible.map(option => <button type="button" key={option.id} aria-pressed={option.selected} disabled={option.disabled}
      onClick={() => onChoose(option.id)}>
      <span className="workspace-option-label">{option.label}</span>
      {option.detail && <span className="workspace-option-detail">{option.detail}</span>}
    </button>)}</div>
    {!visible.length && <p role="status" className="workspace-options-empty">No hay opciones con ese nombre.</p>}
  </fieldset>;
}

export function WorkspaceCustomization(p: CustomizationProps) {
  const [notes, setNotes] = useState(false);
  const [showVariants, setShowVariants] = useState(false);
  const variant = p.family?.variants?.find(({ product }) => product.id === p.product?.id);
  const variants = p.family?.variants ?? [];
  const sized = variants.length > 1 && variants.every(option => option.size);
  const sizes = (['16 oz', '20 oz'] as const).filter(size => variants.some(option => option.size === size));
  const [requestedSize, setSize] = useState<DrinkSize>(variant?.size ?? sizes.find(value => variants.some(option => option.size === value && productAvailable(option.product))) ?? '16 oz');
  const size = variant?.size ?? requestedSize;
  const shownVariants = sized ? variants.filter(option => option.size === size) : variants;
  const chooseSize = (next: DrinkSize) => {
    if (next === size) return;
    setSize(next);
    const equivalent = variant && variants.find(option => option.size === next && option.label === variant.label && productAvailable(option.product));
    p.onVariant?.(equivalent ? equivalent.product.id : null);
    setShowVariants(!equivalent);
  };
  const smoothie = posProfile.id === 'smoothies' && p.product && isSmoothie(p.product) ? p.product : null;
  const [switchOpen, setSwitchOpen] = useState(false);
  const choices = p.steps.map((step, index) => ({ step, index, options: smoothie ? step.options.filter(name =>
    p.dbExtras.some(extra => extra.name === name && extra.phase === step.id)) : step.options })).filter(({ step }) => step.id !== 'notes');
  const missingChoice = choices.some(({ step, options }) => step.required && !p.extras.some(extra => extra.phase === step.id && options.includes(extra.name)));
  const basePrice = Number(p.product?.basePrice ?? p.product?.price ?? 0);
  const extraPrice = p.extras.reduce((sum, extra) => sum + extra.price, 0);
  const total = Math.round((p.quantity ?? 1) * (basePrice + extraPrice) * 100) / 100;
  const creamy = p.extras.some(extra => extra.phase === 'Leche alternativa' || extra.phase === 'Tipo de Leche');
  return <WorkspaceDialog title={smoothie ? 'Arma tu smoothie' : p.family?.name ?? p.product?.name ?? 'Producto'} onClose={p.onClose} className={`workspace-customization${smoothie ? ' smoothie-builder' : ''}`}
    headerAccessory={sized && <div className="workspace-size-picker" role="group" aria-label="Tamaño">{sizes.map(value => <button type="button" key={value} aria-pressed={size === value}
      disabled={!variants.some(option => option.size === value && productAvailable(option.product))} onClick={() => chooseSize(value)}>{value}</button>)}</div>}><div className="workspace-dialog-content">
    {smoothie && <div className="smoothie-preview">
      <div className="smoothie-preview-art" key={smoothie.id}><SmoothieCup name={smoothie.name} creamy={creamy} toppings={p.extras.some(extra => extra.phase === 'Extras')} /></div>
      <div className="smoothie-preview-copy"><h3>{smoothie.name}</h3><p>{p.extras.length ? p.extras.map(extra => extra.name).join(' · ') : 'Receta original'}</p>
        <p>{money(basePrice)}{extraPrice > 0 && ` + ${money(extraPrice)} de extras`}</p></div>
      {!!p.smoothies && p.smoothies.length > 1 && <button type="button" className="smoothie-switch" aria-expanded={switchOpen} onClick={() => setSwitchOpen(!switchOpen)}>Cambiar smoothie</button>}
    </div>}
    {smoothie && switchOpen && p.smoothies && <div className="smoothie-switch-list" role="group" aria-label="Smoothies disponibles">
      {p.smoothies.map(option => <button type="button" key={option.id} aria-pressed={option.id === smoothie.id} disabled={!menuCardAvailable(option)}
        onClick={() => { if (option.id !== smoothie.id) p.onSmoothie?.(option.id); setSwitchOpen(false); }}>{option.name}</button>)}
    </div>}
    {p.quantity !== undefined && <div className="workspace-edit-quantity"><span>Cantidad</span><button type="button" aria-label="Reducir cantidad" disabled={p.quantity <= 1} onClick={() => p.onQuantity?.(p.quantity! - 1)}><Minus size={22} /></button><strong>{p.quantity}</strong><button type="button" aria-label="Aumentar cantidad" onClick={() => p.onQuantity?.(p.quantity! + 1)}><Plus size={22} /></button></div>}
    <button type="button" className="workspace-note-toggle" aria-expanded={notes} onClick={() => setNotes(!notes)}><Pencil size={17} />{p.note || 'Nota de preparación'}</button>
    {notes && <><textarea aria-label="Notas de preparación" rows={2} value={p.note} maxLength={1000} onChange={event => p.onNote(event.target.value)} /><WorkspaceKeyboard value={p.note} onChange={value => p.onNote(value.slice(0, 1000))} /></>}
    {p.family && (variant && !showVariants
      ? <fieldset className="workspace-modifier-group"><legend>{p.family.variantTitle}</legend><div>
        <button type="button" className="workspace-option-current" aria-label={`Cambiar variante: ${variant.label}`} onClick={() => setShowVariants(true)}>
          {variant.label}<span>Cambiar</span>
        </button>
      </div></fieldset>
      : <PreparationChoices key={p.family.id} title={p.family.variantTitle ?? 'Presentación'}
        searchLabel={p.family.variantTitle === 'Elige el sabor' ? 'Buscar sabor' : 'Buscar presentación'}
        options={shownVariants.map(({ product, label }) => ({
          id: product.id, label, selected: product.id === p.product?.id, disabled: !productAvailable(product),
          detail: productAvailable(product) ? money(Number(product.price)) : 'Agotado',
        }))}
        onChoose={id => { p.onVariant?.(id); setShowVariants(false); }} />)}
    {choices.filter(({ options }) => options.length > 0).map(({ step, index, options }) => <PreparationChoices key={step.id}
      title={(smoothie && step.id === 'Leche alternativa' ? 'Cambio de leche' : step.title.replace(/^Seleccionar /, '')) + (step.required ? ' (elige uno)' : '')}
      searchLabel={step.id === 'Helado gourmet' ? 'Buscar helado' : `Buscar en ${step.id.toLowerCase()}`}
      options={options.map(name => {
        const extra = p.dbExtras.find(extra => extra.name === name && extra.phase === step.id);
        return { id: name, label: name, selected: p.extras.some(extra => extra.name === name && (!extra.phase || extra.phase === step.id)),
          detail: Number(extra?.price) > 0 ? `+${money(Number(extra?.price))}` : undefined };
      })} onChoose={name => p.onOption(name, index)} />)}
  </div><footer>{p.onRemove && <button type="button" onClick={p.onRemove}>Quitar</button>}{p.product && <span className="workspace-custom-price" aria-live="polite">{money(total)}</span>}<button type="button" className="workspace-primary" disabled={!p.product || missingChoice} onClick={p.onConfirm}>{p.quantity !== undefined ? 'Guardar cambios' : 'Agregar a la orden'}</button></footer></WorkspaceDialog>;
}

export function WorkspaceCheckout(p: CheckoutProps) {
  const [currency, setCurrency] = useState<'MXN' | 'USD'>('MXN');
  const [cardConfirmed, setCardConfirmed] = useState(false);
  const cash = p.method === 'Efectivo' || p.method === 'Mixto';
  const canCharge = p.smoothies || !!p.phoneOrderLabel || validPagerNumber(p.pagerNumber);
  const parse = (value: string | number) => Number(String(value || 0).replace(',', '.'));
  const received = receivedCashMXN(parse(p.mxn), parse(p.usd), p.exchangeRate);
  const quote = usdCashQuote(p.total, p.exchangeRate);
  const validUSD = !cash || !!p.smoothies || (Number.isInteger(parse(p.usd)) && parse(p.usd) >= 0);
  const change = <div className={`workspace-change ${received < p.total ? 'is-short' : ''}`} aria-live="polite"><span>{received < p.total ? 'Faltan MXN' : 'Cambio MXN'}</span><strong>{money(Math.abs(received - p.total))}</strong></div>;
  const bills = [50, 100, 200, 500, 1000].filter(value => value >= p.total).slice(0, 3);
  const key = (value: string) => { if ((currency === 'USD' ? /^\d{0,8}$/ : /^\d{0,8}(?:\.\d{0,2})?$/).test(value)) (currency === 'MXN' ? p.onMXN : p.onUSD)(value); };
  return <WorkspaceDialog title="Cobrar" onClose={p.onClose} busy={p.busy} className={`workspace-checkout${p.smoothies ? ' smoothie-checkout' : ''}`}><div className="workspace-dialog-content"><div className={`workspace-checkout-main ${cash ? 'has-cash' : ''}`}><section className="workspace-checkout-details"><div className="workspace-checkout-summary"><div><span>Total MXN</span><strong>{money(p.total)}</strong>{!p.smoothies && <div className="workspace-checkout-usd"><span>Total USD</span><b>{quote === null ? '—' : `$${quote.usd}`}</b><small>1 USD = {p.exchangeRate} MXN</small>{quote && <small>Cambio con ${quote.usd} USD: {money(quote.changeMXN)} MXN</small>}</div>}</div>{!p.smoothies && <select aria-label="Tipo de pedido" value={p.orderType} disabled={p.busy||!!p.phoneOrderLabel} onChange={event => p.onOrderType(event.target.value)}><option value="En Local">Para aquí</option><option value="Para Llevar">Para llevar</option></select>}</div>
    <div className="workspace-payment-methods" aria-label="Método de pago">{(p.smoothies ? ['Efectivo', 'Tarjeta'] : ['Efectivo', 'Mixto', 'Tarjeta']).map(method => <button type="button" key={method} disabled={p.busy} aria-pressed={p.method === method} onClick={() => { if (p.method === method) return; p.onMethod(method); setCardConfirmed(false); setCurrency('MXN'); }}>{method === 'Mixto' ? 'MXN + USD' : method}</button>)}</div>
    {cash && <div className="workspace-cash-fields"><label>Recibido MXN<input aria-label="Recibido MXN" inputMode="decimal" disabled={p.busy} value={p.mxn} onFocus={() => setCurrency('MXN')} onChange={event => p.onMXN(event.target.value)} /></label>
      {p.method === 'Mixto' && <label>Recibido USD<input aria-label="Recibido USD" inputMode="numeric" disabled={p.busy} value={p.usd} onFocus={() => setCurrency('USD')} onChange={event => { if (/^\d{0,8}$/.test(event.target.value)) p.onUSD(event.target.value); }} /></label>}
      {p.method === 'Efectivo' && <button type="button" disabled={p.busy} onClick={() => { p.onMXN(String(p.total)); p.onUSD(''); }}>Importe exacto</button>}
      {p.method === 'Mixto' && <><button type="button" disabled={p.busy || quote === null} onClick={() => { if (quote) { p.onMXN(''); p.onUSD(String(quote.usd)); setCurrency('USD'); } }}>Recibir ${quote?.usd ?? '—'} USD</button><p className="workspace-caption">Dólares enteros. El cambio se entrega en pesos.</p></>}
      {p.smoothies && !!bills.length && <div className="smoothie-bills" role="group" aria-label="Billetes recibidos">{bills.map(bill => <button type="button" key={bill} disabled={p.busy} aria-pressed={received === bill} onClick={() => p.onMXN(String(bill))}>${bill}</button>)}</div>}
      {p.smoothies && change}
    </div>}
    {p.method === 'Tarjeta' && !p.clipEnabled && <label className="workspace-card-confirm"><input type="checkbox" disabled={p.busy} checked={cardConfirmed} onChange={event => setCardConfirmed(event.target.checked)} />Pago aprobado en la terminal</label>}
    </section><section className="workspace-checkout-keypad">{p.phoneOrderLabel?<p className="phone-order-state">{p.phoneOrderLabel} · Paga al recoger</p>:p.onPagerNumber&&<PagerPicker value={p.pagerNumber??null} onChange={p.onPagerNumber} disabled={p.busy}/>}{cash && <WorkspaceKeyboard numeric integer={currency === 'USD'} label={`Teclado ${currency}`} disabled={p.busy} value={String(currency === 'MXN' ? p.mxn : p.usd)} onChange={key} />}
  </section></div></div><footer>{cash && !p.smoothies && change}<button type="button" className="workspace-primary" disabled={p.busy || p.insufficient || !canCharge || !validUSD || (p.method === 'Tarjeta' && !p.clipEnabled && !cardConfirmed)} onClick={()=>{if(canCharge && validUSD)p.onConfirm();}}>{p.busy ? 'Confirmando…' : p.method==='Tarjeta'&&p.clipEnabled?'Enviar a CLIP':'Confirmar pago'}</button></footer></WorkspaceDialog>;
}

export function WorkspaceOpening(p: {
  pesosOnly?: boolean;
  userName: string; isAdmin: boolean; denominations: number[]; counts: Record<number, number>;
  onCounts: (counts: Record<number, number>) => void; rate: string; onRate: (value: string) => void;
  dollars: number | ''; onDollars: (value: number | '') => void; total: number;
  busy: boolean; disabled: boolean; onOpen: () => void; onLogout: () => void;
}) {
  const [keyboard, setKeyboard] = useState<'dollars' | null>(null);
  const [dollarDraft, setDollarDraft] = useState(String(p.dollars));
  return <WorkspaceDialog title="Abrir caja" onClose={p.onLogout} busy={p.busy} className="workspace-opening"><div className="workspace-dialog-content">
    <div className="workspace-opening-access"><p className="workspace-caption">{p.userName}</p>{p.isAdmin && <a className="workspace-admin-gateway" href="/admin">Administración</a>}</div>{!p.pesosOnly && <div className="workspace-opening-fields"><div><p>1 USD = {p.rate} MXN</p>{p.isAdmin && <a href="/admin/caja">Tipo de cambio</a>}</div>
      <label>Dólares iniciales<div className="workspace-input-row"><input aria-label="Dólares iniciales" inputMode="decimal" disabled={p.busy} value={dollarDraft} onChange={event => { setDollarDraft(event.target.value); p.onDollars(event.target.value === '' ? '' : Number(event.target.value)); }} /><button type="button" aria-label="Teclado para dólares iniciales" disabled={p.busy} onClick={() => setKeyboard(keyboard === 'dollars' ? null : 'dollars')}><Keyboard size={22} /></button></div></label></div>}
    {keyboard ? <div className="workspace-opening-keypad"><span>Dólares iniciales</span><WorkspaceKeyboard numeric disabled={p.busy} value={dollarDraft} onChange={value => {
      if (!/^\d{0,6}(?:\.\d{0,2})?$/.test(value)) return;
      setDollarDraft(value); p.onDollars(value === '' ? '' : Number(value));
    }} /><button type="button" onClick={() => setKeyboard(null)}>Listo</button></div> : <><h3>Efectivo inicial en pesos</h3><div className="workspace-denominations">{p.denominations.map(value => <label key={value}><strong>{money(value)}</strong><div><button type="button" aria-label={`Quitar una pieza de ${value} pesos`} disabled={p.busy || !p.counts[value]} onClick={() => p.onCounts({ ...p.counts, [value]: Math.max(0, p.counts[value] - 1) })}><Minus size={18} /></button><input type="number" min="0" step="1" aria-label={`Piezas de ${value} pesos`} disabled={p.busy} value={p.counts[value] || ''} onChange={event => p.onCounts({ ...p.counts, [value]: Number(event.target.value) })} /><button type="button" aria-label={`Agregar una pieza de ${value} pesos`} disabled={p.busy} onClick={() => p.onCounts({ ...p.counts, [value]: p.counts[value] + 1 })}><Plus size={18} /></button></div></label>)}</div></>}
  </div><footer><div><span>Fondo inicial MXN</span><strong>{money(p.total)}</strong></div><button type="button" className="workspace-primary" disabled={p.busy || p.disabled} onClick={p.onOpen}>{p.busy ? 'Abriendo…' : 'Abrir caja'}</button></footer>
  </WorkspaceDialog>;
}
