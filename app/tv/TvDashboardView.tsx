'use client';
import { useEffect, useState } from 'react';
import { TV_LOGIN_URL } from '@/lib/login-return';
import { CAFE_TIME_ZONE, visibleTvOrders, tvCountdown, tvTime, type TvSnapshot } from '@/lib/tv-dashboard';
import './tv.css';
export default function TvDashboardView({ snapshot, now, failure, accessLost = false, stale = false }: {
    snapshot: TvSnapshot | null;
    now: Date | null;
    failure: string | null;
    accessLost?: boolean;
    stale?: boolean;
}) {
    const [fullscreenError, setFullscreenError] = useState(false);
    const data = accessLost ? null : snapshot, clock = now ?? (data ? new Date(data.capturedAt) : null);
    const orders = data && clock ? visibleTvOrders(data, clock) : [];
    const pages = Math.max(1, Math.ceil(orders.length / 6)), page = clock ? Math.floor(+clock / 10000) % pages : 0;
    const notice = failure || (stale ? 'No se han recibido órdenes recientes. Revisa la conexión.' : null);
    const clockMs = clock ? +clock : null;
    useEffect(() => {
        if (clockMs === null)
            return;
        const overflow = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (overflow) {
            const progress = Math.max(0, Math.min(1, ((clockMs % 10000) - 2000) / 6000));
            window.scrollTo({ top: overflow * progress, behavior: 'smooth' });
        }
    }, [clockMs]);
    async function fullscreen() { try {
        if (document.fullscreenElement)
            await document.exitFullscreen();
        else
            await document.documentElement.requestFullscreen();
        setFullscreenError(false);
    }
    catch {
        setFullscreenError(true);
    } }
    return <main className="tv-screen"><div className="tv-layout">
 <header className="tv-header"><p className="tv-brand">Cariñito Mío <span>· Preparación</span></p><div className="tv-header-right"><span className="tv-date">{clock && new Intl.DateTimeFormat('es-MX', { timeZone: CAFE_TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long' }).format(clock)}</span><time className="tv-clock">{clock ? tvTime(clock.toISOString()).slice(0, 5) : '—:—'}</time></div></header>
 {(notice || accessLost) && <div role="alert" className="tv-notice"><strong>{accessLost ? 'Acceso requerido' : 'Datos sin actualizar'}</strong><span>{notice}</span>{accessLost && <a href={TV_LOGIN_URL}>Iniciar sesión</a>}</div>}
 <div className="tv-heading"><div><p className="tv-eyebrow">COCINA · SOLO ALIMENTOS</p><h1>Órdenes en preparación</h1></div><p className="tv-count">{data ? `${orders.length} ${orders.length === 1 ? 'orden' : 'órdenes'}` : 'Conectando…'}</p></div>
 {orders.length ? <section className="tv-queue" aria-label="Órdenes de alimentos">{orders.slice(page * 6, page * 6 + 6).map(order => <article className={`tv-card${Date.parse(order.expiresAt) - +clock! <= 300000 ? ' tv-card-soon' : ''}`} key={order.id}>
 <header className="tv-card-header"><div><p className="tv-eyebrow">{order.control ? 'CONTROL' : 'TICKET'}</p><h2>{order.control ?? `#${order.ticket ?? '—'}`}</h2></div><div className="tv-timer"><span>En pantalla</span><strong>{tvCountdown(order.expiresAt, clock!)}</strong></div></header>
 <div className="tv-card-meta"><span>Ticket #{order.ticket ?? '—'}</span><span>{order.service === 'takeaway' || order.service === 'para_llevar' ? 'Para llevar' : order.service === 'dine_in' || order.service === 'comer_aqui' ? 'En mesa' : order.service}</span></div>
 <ul className="tv-items">{order.items.map((item, i) => <li key={i}><div className="tv-item-line"><strong className="tv-quantity">{item.quantity}×</strong><strong>{item.name}</strong></div>{item.extras.map((e, j) => <p className="tv-item-extra" key={j}>{e}</p>)}{item.note && <p className="tv-item-note">{item.note}</p>}</li>)}</ul>{order.note && <p className="tv-order-note">{order.note}</p>}
 </article>)}</section> : <section className="tv-empty"><h2>{data && !notice ? 'Todo listo' : data ? 'Sin órdenes visibles' : accessLost ? 'Acceso requerido' : 'Cargando órdenes…'}</h2><p>{data && !notice ? 'Sin órdenes de alimentos en los últimos 15 minutos.' : 'La lista se actualiza automáticamente.'}</p></section>}
 <footer className="tv-footer"><p>{data ? `Actualizado a las ${tvTime(data.capturedAt)}` : 'Conectando…'}{pages > 1 ? ` · Página ${page + 1} de ${pages} · Cambio automático` : ''}</p><p>Las órdenes salen de pantalla a los 15 min</p><div className="tv-controls"><button onClick={() => void fullscreen()}>Pantalla completa</button><a href="/admin">Administración</a></div></footer>
 {fullscreenError && <p role="alert">Presiona F11 para abrir la pantalla completa.</p>}
 </div></main>;
}
