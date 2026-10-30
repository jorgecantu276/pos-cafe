'use client';
import { useState } from 'react';
import type { ReportQuery } from '@/lib/reports';

export function ReportFilters({ query, onChange }: { query: ReportQuery; onChange: (query: ReportQuery) => void }) {
  const [mode, setMode] = useState(query.period);
  const [from, setFrom] = useState(query.from);
  const [to, setTo] = useState(query.to);
  return <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const start = String(values.get('from') ?? '');
    const end = String(values.get('to') ?? '');
    if (start && end && start <= end) onChange({ ...query, period: 'range', from: start, to: end, page: 0, asOf: null });
  }}>
    <label className="text-sm font-semibold">Periodo<select aria-label="Periodo" className="block rounded-xl border bg-white p-3" value={mode} onChange={event => {
      const period = event.target.value as ReportQuery['period']; setMode(period);
      if (period !== 'range') onChange({ ...query, period, from: '', to: '', page: 0, asOf: null });
    }}><option value="all">Histórico</option><option value="today">Hoy</option><option value="range">Fechas</option></select></label>
    {mode === 'range' && <>
      <label className="text-sm font-semibold">Desde<input name="from" aria-label="Desde" className="block rounded-xl border bg-white p-3" type="date" required value={from} max={to || undefined} onInput={event => setFrom(event.currentTarget.value)} onChange={event => setFrom(event.target.value)} /></label>
      <label className="text-sm font-semibold">Hasta<input name="to" aria-label="Hasta" className="block rounded-xl border bg-white p-3" type="date" required value={to} min={from || undefined} onInput={event => setTo(event.currentTarget.value)} onChange={event => setTo(event.target.value)} /></label>
      <button type="submit" className="rounded-xl bg-slate-900 p-3 text-white">Aplicar fechas</button>
    </>}
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
