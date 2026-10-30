'use client';

import { useState } from 'react';
import { CAFE_TIME_ZONE, tvMoney, tvStatus, tvTime, type TvSnapshot } from '@/lib/tv-dashboard';
import './tv.css';
import { TV_LOGIN_URL } from '@/lib/login-return';

export default function TvDashboardView({ snapshot, now, failure, accessLost = false, stale = false }: {
  snapshot: TvSnapshot | null; now: Date | null; failure: string | null; accessLost?: boolean; stale?: boolean;
}) {
  const [fullscreenError, setFullscreenError] = useState(false);
  const data = accessLost ? null : snapshot;
  const outdated = !!failure || stale;
  const status = accessLost ? 'Acceso requerido' : !data ? (failure ? 'Sin conexión' : 'Cargando ventas…') : outdated ? 'Datos sin actualizar' : 'Actualizado';
  const date = data ? new Date(`${data.day}T12:00:00Z`) : now;
  const max = Math.max(1, ...(data?.hourly ?? []));
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreenError(false);
    } catch { setFullscreenError(true); }
  }
  return <main className="tv-screen">
    <header className="tv-header">
      <div><p className="tv-eyebrow">CARIÑITO MÍO</p>
        <h1>Ventas de hoy</h1>
        <p className="tv-date">{date ? new Intl.DateTimeFormat('es-MX', { timeZone: CAFE_TIME_ZONE, dateStyle: 'full' }).format(date) : 'Cargando fecha…'} · Matamoros</p>
      </div>
      <div className="tv-header-right">
        <p role="status" className={`tv-connection ${outdated || accessLost ? 'tv-warning' : ''}`}><i />{status}</p>
        <time className="tv-clock">{now ? tvTime(now.toISOString()).slice(0, 5) : '—:—'}</time>
        <button className="tv-fullscreen" onClick={() => void fullscreen()}>Pantalla completa</button>
      </div>
    </header>

    {(failure || stale || fullscreenError) && <div role="alert" className="tv-notice">
      {failure || (stale ? 'No se han recibido datos recientes. Revisa la conexión.' : 'No se pudo abrir la pantalla completa. Presiona F11.')}
      {accessLost && <> <a href={TV_LOGIN_URL}>Iniciar sesión</a></>}
    </div>}

    <section className="tv-metrics" aria-label="Resumen de ventas">
      <article className="tv-metric tv-sales"><p>VENTAS <small>MXN</small></p><strong>{data ? tvMoney(data.sales) : '—'}</strong><span>Sin ventas canceladas ni pendientes</span></article>
      <article className="tv-metric"><p>ÓRDENES COMPLETADAS</p><strong>{data?.completed ?? '—'}</strong><span>{data ? `${data.cancelled} canceladas hoy` : 'Cargando…'}</span></article>
      <article className="tv-metric"><p>TICKET PROMEDIO <small>MXN</small></p><strong>{data ? tvMoney(data.average) : '—'}</strong><span>Por orden completada</span></article>
      <article className="tv-metric"><p>PAGOS POR REVISAR</p><strong>{data?.pending ?? '—'}</strong><span>No se suman a las ventas</span></article>
    </section>

    <div className="tv-content">
      <section className="tv-panel tv-orders">
        <div className="tv-section-title"><h2>Últimas órdenes</h2><span>HOY</span></div>
        <table><thead><tr><th>Folio / hora</th><th>Estado de venta</th><th>Importe MXN</th></tr></thead>
          <tbody>{data?.recent.map(order => <tr key={order.id}>
            <td><strong>#{order.ticket_number != null ? String(order.ticket_number).padStart(4, '0') : order.id.slice(0, 8)}</strong><time>{tvTime(order.created_at).slice(0, 5)}</time></td>
            <td><span className={`tv-badge ${order.status === 'completed' ? 'tv-completed' : order.status === 'pending' ? 'tv-pending' : 'tv-other'}`}>{tvStatus(order.status)}</span></td>
            <td>{tvMoney(Number(order.total))}</td>
          </tr>)}</tbody>
        </table>
        {!data?.recent.length && <p className="tv-empty">{data ? 'No hay órdenes de hoy.' : accessLost ? 'Inicia sesión para ver las ventas.' : 'Cargando ventas…'}</p>}
        <p className="tv-footnote">Los estados corresponden al pago, no a la preparación.</p>
      </section>

      <div className="tv-side">
        <section className="tv-panel tv-trend">
          <div className="tv-section-title"><h2>Ventas por hora</h2><span>MXN</span></div>
          <div className="tv-chart" role="img" aria-label={data ? `Ventas completadas por hora: ${data.hourly.map((v, h) => `${h}:00 ${tvMoney(v)}`).join('; ')}` : 'Esperando ventas por hora'}>
            {(data?.hourly ?? Array<number>(24).fill(0)).map((value, hour) => <div key={hour} className="tv-bar-column" title={`${hour}:00 · ${tvMoney(value)}`}>
              <div className="tv-bar-track"><div className="tv-bar" style={{ height: `${value / max * 100}%`, minHeight: value ? 3 : 0 }} /></div>
              <span>{hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}</span>
            </div>)}
          </div>
          <p className="tv-footnote">{data ? `Total de hoy: ${tvMoney(data.sales)}` : 'Cargando ventas…'}</p>
        </section>
        <section className="tv-panel tv-payments">
          <div className="tv-section-title"><h2>Forma de pago</h2><span>COMPLETADAS</span></div>
          {data?.payments.map(payment => <div className="tv-payment" key={payment.name}>
            <span>{payment.name}</span><strong>{tvMoney(payment.total)}</strong>
          </div>)}
          {!data?.payments.length && <p className="tv-empty">{data ? 'No hay ventas completadas hoy.' : 'Cargando…'}</p>}
          <p className="tv-footnote">Pago mixto: se muestra el total, sin separar efectivo y tarjeta.</p>
        </section>
      </div>
    </div>
    <footer className="tv-footer"><span>HORA DE MATAMOROS</span><span>Última actualización: {data ? `${data.day} · ${tvTime(data.capturedAt)}` : 'sin datos'}{outdated && data ? ' · DATOS ANTERIORES' : ''}</span><a href="/admin">Administración</a></footer>
  </main>;
}
