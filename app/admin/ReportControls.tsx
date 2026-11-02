'use client';
import { useId, useState } from 'react';
import type { ReportQuery } from '@/lib/reports';

export function ReportFilters({ query, onChange }: { query: ReportQuery; onChange: (query: ReportQuery) => void }) {
  const [datesOpen, setDatesOpen] = useState(query.period === 'range');
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  const datesId = useId();
  const selectPeriod = (period: 'today' | 'all') => {
    setDatesOpen(false);
    if (period !== query.period) onChange({ ...query, period, from: '', to: '', page: 0, asOf: null });
  };
  return <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const start = String(values.get('from') ?? '');
    const end = String(values.get('to') ?? '');
    if (start && end && start <= end) onChange({ ...query, period: 'range', from: start, to: end, page: 0, asOf: null });
  }}>
    <div className="workspace-report-period" role="group" aria-label="Periodo">
      <button type="button" aria-pressed={query.period === 'today'} onClick={() => selectPeriod('today')}>Hoy</button>
      <button type="button" aria-pressed={query.period === 'all'} onClick={() => selectPeriod('all')}>Histórico</button>
      <button type="button" aria-expanded={datesOpen} aria-controls={datesId} onClick={() => setDatesOpen(!datesOpen)}>Fechas</button>
    </div>
    <div id={datesId} className={datesOpen ? 'workspace-report-dates' : undefined} hidden={!datesOpen}>
      {datesOpen && <>
        <label className="text-sm font-semibold">Desde<input name="from" aria-label="Desde" className="block rounded-xl border bg-white p-3" type="date" required value={from} max={to || undefined} onInput={event => setFrom(event.currentTarget.value)} onChange={event => setFrom(event.target.value)} /></label>
        <label className="text-sm font-semibold">Hasta<input name="to" aria-label="Hasta" className="block rounded-xl border bg-white p-3" type="date" required value={to} min={from || undefined} onInput={event => setTo(event.currentTarget.value)} onChange={event => setTo(event.target.value)} /></label>
        <button type="submit" className="rounded-xl bg-slate-900 p-3 text-white">Aplicar fechas</button>
      </>}
    </div>
    <button type="button" className="rounded-xl border bg-white p-3" onClick={() => onChange({ ...query, page: 0, asOf: null })}>Actualizar</button>

  </form>;
}
export function ReportPagination({ page, pageSize, rows, onPage }: { page: number; pageSize: number; rows: number; onPage: (page: number) => void }) {
  return <nav aria-label="Páginas del reporte" className="flex flex-wrap items-center justify-between gap-4 py-5 text-sm">
    <span>{rows === 0 ? '0 registros' : `${Math.min(page * pageSize + 1, rows)}–${Math.min((page + 1) * pageSize, rows)} de ${rows} registros`}</span>
    <div className="flex gap-3"><button className="rounded-xl border bg-white p-3 disabled:opacity-40" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</button>
      <button className="rounded-xl border bg-white p-3 disabled:opacity-40" disabled={(page + 1) * pageSize >= rows} onClick={() => onPage(page + 1)}>Siguiente</button></div>
  </nav>;
}
