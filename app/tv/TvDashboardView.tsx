'use client';

import { useState } from 'react';
import { TV_LOGIN_URL } from '@/lib/login-return';
import { CAFE_TIME_ZONE, tvMoney, tvStatus, tvTime, type TvSnapshot } from '@/lib/tv-dashboard';
import './tv.css';

const dateFormat = new Intl.DateTimeFormat('es-MX', {
  timeZone: CAFE_TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const axisFormat = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 });

export default function TvDashboardView({ snapshot, now, failure, accessLost = false, stale = false }: {
  snapshot: TvSnapshot | null; now: Date | null; failure: string | null; accessLost?: boolean; stale?: boolean;
}) {
  const [fullscreenError, setFullscreenError] = useState(false);
  const data = accessLost ? null : snapshot;
  const date = data ? new Date(`${data.day}T12:00:00Z`) : now;
  const connection = accessLost ? 'Acceso requerido'
    : data ? (failure || stale ? 'Datos sin actualizar' : 'Actualizado')
    : failure ? 'Sin conexión' : 'Cargando ventas…';
  const notice = failure || (stale ? 'No se han recibido datos recientes. Revisa la conexión.' : null);
  const largestHour = Math.max(1, ...(data?.hourly ?? []));
  const step = 10 ** Math.floor(Math.log10(largestHour));
  const ceiling = Math.ceil(largestHour / step) * step;

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError(false);
    } catch {
      setFullscreenError(true);
    }
  }

  return (
    <main className="tv-screen">
      <div className="tv-layout">
        <header className="tv-header">
          <p className="tv-brand">Cariñito Mío</p>
          <div className="tv-header-right">
            <span className="tv-date">{date && dateFormat.format(date)}</span>
            <time className="tv-clock">{now ? tvTime(now.toISOString()).slice(0, 5) : '—:—'}</time>
          </div>
        </header>

        {(notice || accessLost) && (
          <div role="alert" className="tv-notice">
            <strong>{connection}</strong>
            {notice && <span>{notice}</span>}
            {accessLost && <a href={TV_LOGIN_URL}>Iniciar sesión</a>}
          </div>
        )}

        <div className="tv-grid">
          <section className="tv-summary" aria-labelledby="tv-sales">
            <h1 id="tv-sales">Ventas de hoy</h1>
            <p className="tv-total">
              <strong>{data ? tvMoney(data.sales) : '—'}</strong>
              <span>MXN</span>
            </p>
            <dl className="tv-metrics">
              <div><dt>Órdenes completadas</dt><dd>{data?.completed ?? '—'}</dd></div>
              <div><dt>Ticket promedio</dt><dd>{data ? tvMoney(data.average) : '—'}</dd></div>
            </dl>
          </section>

          <section className="tv-trend" aria-labelledby="tv-hourly">
            <h2 id="tv-hourly">Ventas por hora</h2>
            {data?.hourly.some(value => value > 0) ? (
              <div className="tv-chart" role="img" aria-label={`Ventas por hora en pesos. ${data.hourly.map((value, hour) => `${hour}:00 ${tvMoney(value)}`).join(', ')}`}>
                <div className="tv-chart-axis" aria-hidden="true">
                  <span>{axisFormat.format(ceiling)}</span>
                  <span>{axisFormat.format(ceiling / 2)}</span>
                  <span>0</span>
                </div>
                <div className="tv-chart-hours" aria-hidden="true">
                  {data.hourly.map((value, hour) => (
                    <div className="tv-chart-hour" key={hour} title={`${hour}:00 · ${tvMoney(value)}`}>
                      <div className="tv-bar" style={{ height: `${value / ceiling * 100}%` }} />
                      {hour % 4 === 0 && <span>{String(hour).padStart(2, '0')}:00</span>}
                    </div>
                  ))}
                </div>
              </div>
            ) : <p className="tv-empty">{data ? 'Aún no hay ventas por hora.' : '—'}</p>}
          </section>

          <section className="tv-orders" aria-labelledby="tv-recent">
            <h2 id="tv-recent">Últimas órdenes</h2>
            {data?.recent.length ? (
              <table>
                <thead><tr><th scope="col">Folio</th><th scope="col">Hora</th><th scope="col">Estado</th><th scope="col">Importe</th></tr></thead>
                <tbody>
                  {data.recent.map(order => (
                    <tr key={order.id}>
                      <th scope="row">#{order.ticket_number != null ? String(order.ticket_number).padStart(4, '0') : order.id.slice(0, 8)}</th>
                      <td><time dateTime={order.created_at}>{tvTime(order.created_at).slice(0, 5)}</time></td>
                      <td className={order.status === 'pending' ? 'tv-attention' : undefined}>{tvStatus(order.status)}</td>
                      <td>{tvMoney(Number(order.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="tv-empty">{data ? 'Aún no hay órdenes.' : '—'}</p>}
          </section>

          <section className="tv-payments" aria-labelledby="tv-payments">
            <h2 id="tv-payments">Ventas por forma de pago</h2>
            {data?.payments.length ? (
              <dl className="tv-payment-list">
                {data.payments.map(payment => (
                  <div key={payment.name}>
                    <dt>{payment.name}</dt>
                    <dd>{tvMoney(payment.total)}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="tv-empty">{data ? 'Aún no hay ventas completadas.' : '—'}</p>}
            {data?.payments.some(payment => payment.name === 'Mixto') && (
              <p className="tv-payment-note">Mixto agrupa el importe completo de esas órdenes.</p>
            )}
            {data && (data.pending > 0 || data.cancelled > 0) && (
              <ul className="tv-exceptions">
                {data.pending > 0 && <li className="tv-attention">{data.pending === 1 ? '1 pago por revisar' : `${data.pending} pagos por revisar`}</li>}
                {data.cancelled > 0 && <li>{data.cancelled === 1 ? '1 orden cancelada' : `${data.cancelled} órdenes canceladas`}</li>}
              </ul>
            )}
          </section>
        </div>

        {fullscreenError && <p role="alert" className="tv-fullscreen-error">Presiona F11 para abrir la pantalla completa.</p>}
        <footer className="tv-footer">
          <p role={data ? undefined : 'status'}>{data ? `Actualizado a las ${tvTime(data.capturedAt)}` : notice || accessLost ? '' : connection}</p>
          <div className="tv-controls">
            <button type="button" onClick={() => void fullscreen()}>Pantalla completa</button>
            <a href="/admin">Administración</a>
          </div>
        </footer>
      </div>
    </main>
  );
}
