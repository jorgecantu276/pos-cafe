'use client';

import { useEffect, useState } from 'react';
import { canReprintTicket, readRecentTickets, ticketStatusLabel, type RecentTicket } from '@/lib/recent-tickets';

async function loadRecentTickets(signal: AbortSignal) {
  const { supabase } = await import('@/lib/supabase');
  return readRecentTickets(supabase, signal);
}

const date = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Matamoros', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

export default function RecentTickets({ onReprint, disabled = false, loadTickets = loadRecentTickets }: {
  onReprint: (ticketNumber: string) => void;
  disabled?: boolean;
  loadTickets?: (signal: AbortSignal) => Promise<RecentTicket[]>;
}) {
  const [tickets, setTickets] = useState<RecentTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadTickets(controller.signal).then(rows => {
      if (!controller.signal.aborted) { setTickets(rows); setLoading(false); }
    }).catch(() => {
      if (!controller.signal.aborted) { setError('No se pudieron cargar los tickets. Revisa la conexión.'); setLoading(false); }
    });
    return () => controller.abort();
  }, [attempt, loadTickets]);
  return <section className="workspace-recent-tickets" aria-label="Tickets recientes" aria-busy={loading}>
    <div className="workspace-recent-heading"><h3>Tickets recientes</h3><span>Últimos 10 tickets</span></div>
    {loading ? <p role="status">Cargando tickets…</p> : error ? <div role="alert"><p>{error}</p>
      <button type="button" onClick={() => { setLoading(true); setError(''); setAttempt(value => value + 1); }}>Volver a intentar</button></div>
      : !tickets.length ? <p>Todavía no hay tickets.</p>
      : <ul className="workspace-recent-list">{tickets.map(ticket => <li key={ticket.id}>
        <div className="workspace-recent-copy"><strong>#{ticket.ticket_number} <span>{money.format(ticket.total)} MXN</span></strong>
          <span>{ticket.created_at ? <time dateTime={ticket.created_at}>{date.format(new Date(ticket.created_at))}</time> : 'Fecha no registrada'} · {ticket.cashier_name}</span>
          <span className={`workspace-ticket-status ${ticket.status === 'completed' ? 'is-completed' : 'is-review'}`}>{ticketStatusLabel(ticket.status)}</span></div>
        <button type="button" disabled={disabled || !canReprintTicket(ticket.status)} onClick={() => onReprint(ticket.ticket_number)}
          aria-label={`Reimprimir ticket ${ticket.ticket_number}`}>Reimprimir</button>
      </li>)}</ul>}
  </section>;
}
