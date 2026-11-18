'use client';

import { useEffect, useState } from 'react';
import { TV_REFRESH_MS, tvIsStale, type TvSnapshot } from '@/lib/tv-dashboard';
import TvDashboardView from './TvDashboardView';

export default function TvDashboard() {
  const [snapshot, setSnapshot] = useState<TvSnapshot | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [accessLost, setAccessLost] = useState(false);

  useEffect(() => {
    let stopped = false, busy = false, denied = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: AbortController | undefined;
    const refresh = async () => {
      if (stopped || busy || denied) return;
      clearTimeout(timer);
      busy = true;
      current = new AbortController();
      const timeout = setTimeout(() => current?.abort(), 12_000);
      try {
        const response = await fetch('/api/tv', { cache: 'no-store', signal: current.signal, redirect: 'error' });
        if (response.status === 401 || response.status === 403) {
          denied = true;
          if (!stopped) { setSnapshot(null); setAccessLost(true); setFailure('Inicia sesión con una cuenta de administrador para ver las órdenes.'); }
          return;
        }
        if (!response.ok) throw new Error('No se pudo actualizar');
        const next = await response.json() as TvSnapshot;
        if (!next || !Number.isFinite(Date.parse(next.capturedAt)) || !Array.isArray(next.orders)) throw new Error('Respuesta inválida');
        if (!stopped) { setSnapshot(next); setFailure(null); setNow(new Date()); }
      } catch {
        if (!stopped) setFailure('No se pudieron cargar las órdenes. Se intentará de nuevo.');
      } finally {
        clearTimeout(timeout);
        busy = false;
        if (!stopped && !denied) timer = setTimeout(() => void refresh(), TV_REFRESH_MS);
      }
    };
    const wake = () => { if (!document.hidden) void refresh(); };
    const tick = setInterval(() => setNow(new Date()), 1_000);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    void refresh();
    return () => {
      stopped = true;
      current?.abort(); clearTimeout(timer); clearInterval(tick);
      window.removeEventListener('online', wake); window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, []);

  return <TvDashboardView snapshot={snapshot} now={now} failure={failure} accessLost={accessLost}
    stale={!!snapshot && !!now && tvIsStale(snapshot, now)} />;
}
