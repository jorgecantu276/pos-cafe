'use client';

import { useState } from 'react';
import { errorMessage } from '@/lib/pos-types';
import { inventoryCsv, inventoryStatus, inventoryUnits, previewInventoryCsv, type InventoryChange, type InventoryCsvPreview, type InventoryItem, type InventoryMovement } from '@/lib/inventory';

export function InventoryWorkspace({ items, history, disabled, onSave, onRefresh, before, onHistoryPage, hideTitle = false }: {
  items: InventoryItem[]; history: InventoryMovement[]; disabled: boolean;
  onSave: (changes: InventoryChange[]) => Promise<boolean>; onRefresh: () => void;
  before: number | null; onHistoryPage: (before: number | null) => void;
  hideTitle?: boolean;
}) {
  const [tab, setTab] = useState<'products' | 'history'>('products');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('active'), [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<InventoryCsvPreview | null>(null), [csvError, setCsvError] = useState('');
  const active = items.find(i => i.product_id === selected) ?? null;
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const shown = items.filter(i => normalize(i.name + ' ' + i.code).includes(normalize(search))
    && (filter === 'inactive' ? !i.is_active : i.is_active)
    && (filter === 'low' ? i.mode === 'counted' && i.quantity !== null && (i.quantity === 0 || i.minimum !== null && i.quantity <= i.minimum)
      : filter === 'unknown' ? i.mode === 'counted' && i.quantity === null : filter === 'availability' ? i.mode === 'availability' : true));
  const download = () => {
    const blob = new Blob([inventoryCsv(items)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'inventario-carinito-mio.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <header className="inventory-heading"><div>{!hideTitle && <h1>Inventario</h1>}</div><div className="inventory-buttons">
      <button disabled={disabled} onClick={onRefresh}>Actualizar</button><button disabled={disabled} onClick={download}>Descargar CSV</button>
      <label className="inventory-file">Importar CSV<input aria-label="Importar CSV" type="file" accept=".csv,text/csv" disabled={disabled} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; setCsvError(''); setPreview(null);
        if (!file) return;
        try { if (file.size > 300_000) throw new Error('El CSV admite hasta 300 KB.'); setPreview(previewInventoryCsv(await file.text(), items)); }
        catch (error) { setCsvError(errorMessage(error)); }
      }} /></label></div></header>
    {csvError && <p className="inventory-error" role="alert">{csvError}</p>}
    {preview && <section className="inventory-preview" aria-label="Vista previa del CSV"><h2>Revisar importación</h2>
      <p>{preview.changes.length} {preview.changes.length === 1 ? 'producto' : 'productos'} · {preview.errors.length} {preview.errors.length === 1 ? 'error' : 'errores'}</p>
      {preview.errors.length > 0 && <ul role="alert">{preview.errors.map((e, n) => <li key={n}>{e}</li>)}</ul>}
      <div className="inventory-preview-table"><table><thead><tr><th>Producto</th><th>Modo</th><th>Cantidad después de importar</th></tr></thead><tbody>{preview.changes.map((c, n) => {
        const item = preview.items[n];
        const quantity = c.quantity ?? (item.mode === 'counted' && item.unit === c.unit ? item.quantity : null);
        const unit = quantity === 1 ? c.unit : c.unit === 'pastel' ? 'pasteles' : `${c.unit}s`;
        return <tr key={c.product_id}><td>{item.name}<small>{item.code}</small></td><td>{c.mode === 'counted' ? 'Conteo' : 'Disponibilidad'}</td><td>{c.mode !== 'counted' ? c.available ? 'Disponible' : 'Agotado'
          : quantity === null ? 'Sin contar' : `${quantity} ${unit}`}</td></tr>;
      })}</tbody></table></div><p>Las cantidades reemplazan el conteo actual. Deja una celda vacía para conservarlo.</p>
      <div className="inventory-buttons"><button className="inventory-primary" disabled={disabled || preview.errors.length > 0 || !preview.changes.length} onClick={async () => { if (await onSave(preview.changes)) setPreview(null); }}>Guardar importación</button><button disabled={disabled} onClick={() => setPreview(null)}>Cerrar</button></div>
    </section>}
    <div className="inventory-tabs" role="tablist" aria-label="Inventario" onKeyDown={event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?'products':event.key==='End'?'history':tab==='products'?'history':'products';
      setTab(next);document.getElementById(`inventory-${next}-tab`)?.focus();
    }}>
      <button id="inventory-products-tab" role="tab" tabIndex={tab==='products'?0:-1} aria-selected={tab === 'products'} aria-controls="inventory-products" onClick={() => setTab('products')}>Productos</button>
      <button id="inventory-history-tab" role="tab" tabIndex={tab==='history'?0:-1} aria-selected={tab === 'history'} aria-controls="inventory-history" onClick={() => setTab('history')}>Movimientos</button>
    </div>
    <section id="inventory-products" role="tabpanel" aria-labelledby="inventory-products-tab" hidden={tab !== 'products'}>
      <div className="inventory-filters"><input aria-label="Buscar producto" placeholder="Buscar producto o código" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Filtrar inventario" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Todos los productos activos</option><option value="low">Por reponer</option><option value="unknown">Sin contar</option><option value="availability">Solo disponibilidad</option><option value="inactive">Productos inactivos</option></select></div>
      <div className="inventory-layout"><div className="inventory-list"><div className="inventory-columns"><span>Producto</span><span>Existencia</span><span>Estado</span></div>
        {shown.map(i => <button className="inventory-row" key={i.product_id} aria-pressed={i.product_id === selected} onClick={() => { setSelected(i.product_id); if (window.matchMedia?.('(max-width:850px)')?.matches) requestAnimationFrame(() => document.querySelector('.inventory-detail')?.scrollIntoView({ block: 'start' })); }}>
          <span>{i.name}<small>{i.code} · {i.mode === 'counted' ? i.unit : 'Disponibilidad'}</small></span><strong>{i.mode === 'counted' ? i.quantity ?? '—' : '—'}</strong><span className={inventoryStatus(i) === 'Agotado' ? 'inventory-out' : inventoryStatus(i) === 'Por reponer' ? 'inventory-low' : ''}>{inventoryStatus(i)}</span>
        </button>)}{!shown.length && <p className="inventory-empty">No hay productos en esta vista.</p>}</div>
        {active ? <InventoryDetail key={`${active.product_id}:${active.revision}`} item={active} disabled={disabled} onSave={onSave} onClose={() => setSelected('')} /> : <aside className="inventory-detail inventory-empty">Selecciona un producto para ver sus existencias.</aside>}
      </div>
    </section>
    <section id="inventory-history" role="tabpanel" aria-labelledby="inventory-history-tab" hidden={tab !== 'history'}>
      <div className="inventory-movements">{history.map(m => <div key={m.id}><div><strong>{m.product_name}</strong><p>{m.reason}{m.ticket_number !== null ? ` · Ticket #${m.ticket_number}` : ''}</p><small>{m.actor_name} · {new Date(m.created_at).toLocaleString('es-MX', { timeZone: 'America/Matamoros' })}</small></div><span>{m.kind === 'configure' || m.kind === 'availability' ? 'Configuración' : `${m.before_quantity ?? 'Sin contar'} → ${m.after_quantity ?? 'Sin contar'} ${m.unit}`}</span></div>)}{!history.length && <p className="inventory-empty">Todavía no hay movimientos.</p>}</div>
      <div className="inventory-buttons">{before !== null && <button disabled={disabled} onClick={() => onHistoryPage(null)}>Más recientes</button>}{history.length === 100 && <button disabled={disabled} onClick={() => onHistoryPage(history[history.length - 1].id)}>Ver anteriores</button>}</div>
    </section>
  </>;
}

function InventoryDetail({ item, disabled, onSave, onClose }: { item: InventoryItem; disabled: boolean;
  onSave: (changes: InventoryChange[]) => Promise<boolean>; onClose: () => void }) {
  const [action, setAction] = useState<InventoryChange['action'] | null>(null), [quantity, setQuantity] = useState(''), [reason, setReason] = useState('Caducado');
  const [mode, setMode] = useState(item.mode), [unit, setUnit] = useState(item.unit), [minimum, setMinimum] = useState(item.minimum?.toString() ?? '');
  const [error, setError] = useState('');
  const change = (data: Omit<InventoryChange, 'product_id' | 'revision'>) => onSave([{ product_id: item.product_id, revision: item.revision, ...data }]);
  const titles = { count: 'Contar stock', receive: 'Agregar stock', waste: 'Registrar merma' };
  const numeric = /^(0|[1-9]\d*)$/.test(quantity) ? Number(quantity) : NaN;
  const after = action === 'count' ? numeric : item.quantity === null ? NaN : action === 'receive' ? item.quantity + numeric : item.quantity - numeric;
  return <aside className="inventory-detail" aria-label={`Inventario de ${item.name}`}><div className="inventory-detail-heading"><h2>{item.name}</h2><button aria-label="Cerrar producto" onClick={onClose}>Cerrar</button></div><small>{item.code}{!item.is_active ? ' · Inactivo' : ''}</small>
    <div className="inventory-count">{item.mode === 'availability' ? inventoryStatus(item) : item.quantity ?? 'Sin contar'}</div><p>{item.mode === 'counted' ? item.unit : 'Se muestra en caja'}</p>
    {item.mode === 'availability' ? <button className="inventory-primary" disabled={disabled} onClick={() => void change({ action: 'availability', available: !item.available })}>{item.available ? 'Marcar agotado' : 'Marcar disponible'}</button>
      : <div className="inventory-actions">{(['receive', 'count', 'waste'] as const).map(a => <button key={a} disabled={disabled || (a !== 'count' && item.quantity === null) || (a === 'waste' && item.quantity === 0)} aria-pressed={action === a} onClick={() => { setAction(a); setQuantity(''); setError(''); }}>{titles[a]}</button>)}</div>}
    {action && action in titles && <form onSubmit={async e => {
      e.preventDefault(); setError('');
      if (!Number.isInteger(numeric) || numeric < (action === 'count' ? 0 : 1) || after < 0 || after > 1_000_000) { setError('Revisa la cantidad. No puede dejar existencias negativas.'); return; }
      if (await change({ action, quantity: numeric, reason: action === 'waste' ? reason : undefined })) { setAction(null); setQuantity(''); }
    }}><h3>{titles[action as keyof typeof titles]}</h3><label>Cantidad {action === 'count' ? 'física total' : action === 'receive' ? 'a agregar' : 'de merma'}<input type="number" inputMode="numeric" min={action === 'count' ? 0 : 1} max="1000000" step="1" required disabled={disabled} value={quantity} onInput={e => setQuantity(e.currentTarget.value)} onChange={e => setQuantity(e.target.value)} /></label>
      {action === 'waste' && <label>Motivo<select disabled={disabled} value={reason} onChange={e => setReason(e.target.value)}><option>Caducado</option><option>Dañado</option><option>Consumo del personal</option><option>Otro</option></select></label>}
      {quantity && Number.isInteger(after) && <p>Quedarán {after} {item.unit}.</p>}{error && <p role="alert" className="inventory-error">{error}</p>}<button className="inventory-primary" disabled={disabled} type="submit">Guardar {action === 'count' ? 'conteo' : action === 'receive' ? 'entrada' : 'merma'}</button>
    </form>}
    {item.mode === 'counted' && <small>{item.last_counted_at ? `Último conteo: ${new Date(item.last_counted_at).toLocaleString('es-MX', { timeZone: 'America/Matamoros' })}` : 'Todavía no se ha contado este producto.'}</small>}
    <details><summary>Configurar producto</summary><form onSubmit={async e => { e.preventDefault(); setError(''); if (minimum && (!/^\d+$/.test(minimum) || Number(minimum) > 1_000_000)) { setError('Revisa el mínimo.'); return; } await change({ action: 'configure', mode, unit, minimum: minimum ? Number(minimum) : null }); }}>
      <label>Control<select aria-label="Control" value={mode} disabled={disabled} onChange={e => setMode(e.target.value as InventoryItem['mode'])}><option value="availability">Disponible / agotado</option><option value="counted">Conteo de existencias</option></select></label>
      <label>Unidad<select aria-label="Unidad" value={unit} disabled={disabled} onChange={e => setUnit(e.target.value as InventoryItem['unit'])}>{inventoryUnits.map(u => <option key={u}>{u}</option>)}</select></label>
      <label>Avisar cuando queden<input type="number" inputMode="numeric" min="0" max="1000000" step="1" placeholder="Opcional" value={minimum} disabled={disabled} onChange={e => setMinimum(e.target.value)} /></label>
      {(mode !== item.mode || unit !== item.unit) && <p>Después de cambiarlo, vuelve a contar este producto.</p>}{error && <p role="alert" className="inventory-error">{error}</p>}<button disabled={disabled} type="submit">Guardar configuración</button>
    </form></details>
  </aside>;
}
