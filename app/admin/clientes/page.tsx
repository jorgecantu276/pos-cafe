'use client';

import { loadReport, reportMoney, reportDate, type CustomerReport } from '@/lib/reports';
import { useResource } from '@/lib/use-resource';
import LoadFailure from '@/app/LoadFailure';
import { ReportPagination } from '../ReportControls';
import { readCustomerCorrection, recoverCustomerCorrection, saveCustomerCorrection, type CustomerCorrection, type PendingCustomerCorrection } from '@/lib/customer-management';
import { errorMessage } from '@/lib/pos-types';
import { withDeadline } from '@/lib/request-deadline';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Search, Star, Phone } from 'lucide-react';
import CustomerHistory from './CustomerHistory';

export default function ClientesPage() {
  const [query, setQuery] = useState({ search: '', page: 0 });
  const [historyCustomer, setHistoryCustomer] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback((signal: AbortSignal) => loadReport<CustomerReport>(supabase, 'pos_customer_report', { p_search: query.search, p_page: query.page }, signal), [query]);
  const { data: report, loading, error, reload } = useResource<CustomerReport | null>(load, null);
  const filtered = report?.customers ?? [];
  const [actor, setActor] = useState('');
  const actorRef = useRef('');
  const [editing, setEditing] = useState<CustomerCorrection | null>(null);
  const [pending, setPending] = useState<PendingCustomerCorrection | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [correctionError, setCorrectionError] = useState('');
  const [correctionMessage, setCorrectionMessage] = useState('');
  const [pendingUnreadable, setPendingUnreadable] = useState(false);

  useEffect(() => {
    let active = true, revision = 0;
    const accept = (id: string) => {
      if (!active || actorRef.current === id) return;
      actorRef.current = id; setActor(id); setEditing(null); setCorrectionMessage('');
      setCorrectionError(''); setPending(null); setPendingUnreadable(false);
      savingRef.current = false; setSaving(false);
      if (!id) return;
      try { setPending(readCustomerCorrection(localStorage, id)); }
      catch (failure) { setPendingUnreadable(true); setCorrectionError(errorMessage(failure)); }
    };
    const started = revision;
    void withDeadline(() => supabase.auth.getUser()).then(({ data, error }) => {
      if (!active || started !== revision) return;
      if (error || !data.user) { setCorrectionError('No se pudo verificar tu sesión. Recarga antes de corregir clientes.'); return; }
      accept(data.user.id);
    }).catch(failure => { if (active && started === revision) setCorrectionError(errorMessage(failure)); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { revision++; accept(session?.user.id ?? ''); });
    const changed = (event: StorageEvent) => {
      if (event.key !== null && event.key !== `pos_customer_edit:v1:${actorRef.current}`) return;
      try { setPending(readCustomerCorrection(localStorage, actorRef.current)); setPendingUnreadable(false); }
      catch (failure) { setPendingUnreadable(true); setCorrectionError(errorMessage(failure)); }
    };
    window.addEventListener('storage', changed);
    return () => { active = false; actorRef.current = ''; listener.subscription.unsubscribe(); window.removeEventListener('storage', changed); };
  }, []);

  const correctCustomer = async (recover: boolean) => {
    if (savingRef.current || !actor || (!recover && !editing)) return;
    const owner = actor;
    savingRef.current = true; setSaving(true); setCorrectionError(''); setCorrectionMessage('');
    try {
      const customer = recover ? await recoverCustomerCorrection(supabase, localStorage, owner)
        : await saveCustomerCorrection(supabase, localStorage, owner, editing!);
      if (actorRef.current !== owner) return;
      setEditing(null); setPending(null);
      setCorrectionMessage(`Datos guardados: ${customer.name} · ${customer.phone}. Conserva sus puntos y compras.`);
      setQuery(current => ({ ...current }));
    } catch (failure) {
      if (actorRef.current === owner) setCorrectionError(errorMessage(failure));
    } finally {
      if (actorRef.current === owner) {
        try { setPending(readCustomerCorrection(localStorage, owner)); setPendingUnreadable(false); }
        catch (failure) { setPendingUnreadable(true); setCorrectionError(errorMessage(failure)); }
        savingRef.current = false; setSaving(false);
      }
    }
  };

  return (
    <div className="workspace-customers space-y-8">
      <header className="workspace-admin-heading-row">
        <div>
          <h1>Clientes</h1>
          <p className="admin-description">Datos, puntos e historial de compras</p>
        </div>
      </header>
      <div className="admin-list-toolbar">
        <label className="admin-field customer-search">Buscar cliente<span className="admin-search-field">
          <Search size={18} aria-hidden="true"/>
          <input 
            type="text" 
            placeholder="Nombre o teléfono"
            aria-label="Buscar clientes por nombre o teléfono"
            maxLength={100}
            value={query.search}
            onChange={event => setQuery({ search: event.target.value, page: 0 })}
          />
        </span></label>
        <button className="admin-secondary-button" onClick={() => setQuery({ ...query, page: 0 })}>Actualizar clientes</button>
      </div>
      <p className="text-sm text-slate-500">Las compras mostradas excluyen ventas canceladas y pendientes. Los puntos se muestran por separado.</p>
      {correctionError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4">{correctionError}</p>}
      {correctionMessage && <p role="status" className="rounded-xl bg-emerald-50 p-4">{correctionMessage}</p>}
      {historyCustomer && <CustomerHistory key={historyCustomer.id} customer={historyCustomer} onClose={() => setHistoryCustomer(null)}/>}
      {pending && <section aria-label="Corrección pendiente" className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
        <p>Corrección sin confirmar: {pending.payload.name} · {pending.payload.phone}. Recupera la misma solicitud antes de modificar otros datos.</p>
        <button type="button" disabled={saving} className="rounded-xl border bg-white p-3 font-bold" onClick={() => void correctCustomer(true)}>{saving ? 'Verificando corrección…' : 'Recuperar la misma corrección'}</button>
      </section>}
      {editing && <section aria-label="Corregir cliente" className="rounded-2xl border bg-white p-6">
        <h3 className="text-xl font-bold">Corregir nombre y teléfono</h3>
        <p className="mt-2 text-sm text-slate-500">Se corrigen los datos del cliente y se conservan sus puntos e historial de compras.</p>
        <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void correctCustomer(false); }}>
          <fieldset disabled={saving || !!pending || pendingUnreadable} className="space-y-4">
            <label className="block">Nombre<input required maxLength={150} aria-label="Nombre del cliente" className="mt-1 block w-full rounded-xl border p-3" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
            <label className="block">Teléfono / WhatsApp<input required type="tel" inputMode="tel" maxLength={60} aria-label="Teléfono del cliente" className="mt-1 block w-full rounded-xl border p-3" value={editing.phone} onChange={event => setEditing({ ...editing, phone: event.target.value })} /></label>
            <p className="text-sm text-slate-500">10 dígitos para México o de 10 a 15 para un número internacional. El teléfono debe pertenecer a este cliente.</p>
            <button type="submit" className="rounded-xl bg-blue-600 p-3 font-bold text-white">{saving ? 'Guardando…' : 'Guardar corrección'}</button>
          </fieldset>
          <button type="button" disabled={saving} className="rounded-xl border p-3" onClick={() => setEditing(null)}>Cerrar edición</button>
        </form>
      </section>}
      {error ? <LoadFailure message={error} retry={reload} /> : loading ? <p role="status">Verificando clientes…</p> : report && <>
      <p className="text-sm">{report.summary.rows} clientes · Compras completadas {reportMoney(report.summary.sales)} · Actualizado {reportDate(report.captured_at)}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(customer => (
          <div key={customer.id} className="customer-card">
            <div className="customer-card-heading"><h2>{customer.name}</h2>
              <div className="customer-points">
                <Star size={12} fill="currentColor" /> {customer.points} puntos
              </div>
            </div>
            <button type="button" aria-label={`Corregir datos de ${customer.name}`} disabled={!actor || saving || !!pending || pendingUnreadable} className="mt-3 rounded-xl border px-3 py-2 text-sm font-bold disabled:opacity-50" onClick={() => {
              setEditing({ customer_id: customer.id, name: customer.name, phone: customer.phone ?? '' }); setCorrectionError(''); setCorrectionMessage('');
            }}>Corregir datos</button>
            <div className="space-y-2 mt-4">
              <p className="text-xs text-slate-400 flex items-center gap-2"><Phone size={14}/> {customer.phone || 'Sin teléfono'}</p>
            </div>
            <div className="customer-card-total">
               <div>
                 <p className="admin-description">Compras completadas</p>
                 <p className="text-xl font-black text-slate-900">{reportMoney(customer.completed_spent)}</p>
               </div>
               <button type="button" className="rounded-xl border px-3 py-2 text-sm font-bold" onClick={() => setHistoryCustomer({ id: customer.id, name: customer.name })}>Ver compras</button>
            </div>
          </div>
        ))}
      </div>
      <ReportPagination page={report.page} pageSize={report.page_size} rows={report.summary.rows} onPage={page => setQuery({ ...query, page })} />
      </>}
    </div>
  );
}
