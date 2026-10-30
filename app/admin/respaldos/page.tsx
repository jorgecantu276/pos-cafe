'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BackupStatus } from '@/lib/business-backup-server';

const date = (value: string) => new Date(value).toLocaleString('es-MX', { timeZone: 'America/Matamoros' });
export default function BackupsPage() {
  const [status, setStatus] = useState<BackupStatus | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch('/api/backups', { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'No se pudo consultar el respaldo.');
    setStatus(result);
  }, []);
  useEffect(() => { void Promise.resolve().then(load).catch(() => setError('No se pudo consultar el respaldo. Vuelve a intentar.')); }, [load]);
  const run = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/backups', { method: 'POST', headers: { 'X-Pos-Backup': '1' }, signal: AbortSignal.timeout(90_000) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'No se confirmó el respaldo. Consulta su estado.');
      setStatus(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se confirmó el respaldo. Consulta su estado.'); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  return <div className="max-w-3xl space-y-5"><h1 className="text-2xl font-bold">Respaldos</h1>
    <p>La caja revisa el respaldo al iniciar, guarda una copia cifrada por día y otra al terminar o cambiar turno. Requiere conexión. Solo el responsable administra estas copias.</p>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    <button type="button" className="rounded-xl border px-4 py-3" disabled={busy} onClick={() => void load().then(() => setError('')).catch(() => setError('No se pudo consultar el respaldo. Vuelve a intentar.'))}>Actualizar estado</button>
    {!status && !error && <p role="status">Consultando respaldo…</p>}
    {status && <section className="rounded-2xl border bg-white p-5 space-y-3">
      {status.message && <p role="status">{status.message}</p>}
      {status.lastSuccess ? <><p className="font-bold">Último respaldo confirmado: {date(status.lastSuccess.createdAt)}</p>
        <p>{(status.lastSuccess.bytes / 1024 / 1024).toFixed(2)} MB · Cifrado y verificado</p>
        <a className="inline-block rounded-xl border px-4 py-3" href="/api/backups?download=latest">Descargar copia cifrada</a></>
        : <p>Todavía no hay un respaldo confirmado en esta PC.</p>}
      {status.lastError && <p role="alert" className="text-red-800">{status.lastError}</p>}
      {status.lastAttemptAt && <p>Último intento: {date(status.lastAttemptAt)}</p>}
      {status.retainedBytes !== undefined && <p>{status.retainedCopies} copias locales · {(status.retainedBytes / 1024 / 1024).toFixed(2)} MB. Se conservan hasta 14 copias y 512 MB.</p>}
      {(busy || status.running) && <p role="status">Preparando respaldo… Puedes seguir usando la caja.</p>}
      <button type="button" className="rounded-xl bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50" disabled={busy || !status.enabled || status.running} onClick={() => void run()}>Crear respaldo ahora</button>
    </section>}
    <p>Conserva también una copia fuera de esta PC y la clave de recuperación por separado. Una copia en el mismo disco no protege contra su pérdida.</p>
    <p>El historial local de impresión se conserva aparte. Antes de recuperar datos, el responsable debe revisar las ventas y las copias de impresión pendientes.</p>
  </div>;
}
