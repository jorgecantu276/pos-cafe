'use client';
import { posProfile } from '@/lib/pos-profile';

import { useCallback, useEffect, useState } from 'react';
import type { BackupStatus } from '@/lib/business-backup-server';
import { useResource } from '@/lib/use-resource';
import { SettingsGroup, SettingsRow, SettingsNotice } from '../Settings';

const date = (value: string) => new Date(value).toLocaleString('es-MX', { timeZone: 'America/Matamoros' });
export default function BackupsPage() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const readStatus = useCallback(async (signal: AbortSignal): Promise<BackupStatus> => {
    const response = await fetch('/api/backups', { cache: 'no-store', signal });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'No se pudieron cargar los respaldos.');
    return result;
  }, []);
  const { data: status, setData: setStatus, error: readError, reload: load } = useResource<BackupStatus | null>(readStatus, null);
  const failure = error || (readError ? 'No se pudieron cargar los respaldos.' : '');
  useEffect(() => {
    if (!status?.running || busy) return;
    let active = true;
    const poll = async () => {
      await load();
      if (active) timer = window.setTimeout(poll, 1_000);
    };
    let timer = window.setTimeout(poll, 1_000);
    return () => { active = false; window.clearTimeout(timer); };
  }, [status?.running, busy, load]);
  const run = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch('/api/backups', { method: 'POST', headers: { 'X-Pos-Backup': '1' }, signal: AbortSignal.timeout(90_000) });
      const result = await response.json(); if (!response.ok) throw Error(result.error || 'No se confirmó el respaldo. Actualiza para comprobarlo.');
      setStatus(result);
      await load();
    } catch { setError('No se confirmó el respaldo. Actualiza para comprobarlo.'); await load().catch(() => {}); }
    finally { setBusy(false); }
  };
  return <div className="settings-page"><div className="settings-page-heading"><h1>Respaldos</h1><button type="button" className="settings-button" disabled={busy} onClick={() => void load().then(() => setError('')).catch(() => setError('No se pudieron cargar los respaldos.'))}>Actualizar</button></div>
    {failure && <SettingsNotice error>{failure}</SettingsNotice>}
    {!status && !failure && <p role="status">Cargando respaldos…</p>}
    {status && <>
      <SettingsGroup title="Copias de seguridad">
        <SettingsRow label="Respaldo automático" detail={status.enabled ? 'Diario y al terminar turno' : undefined}><span className={`settings-badge${status.enabled ? ' is-on' : ''}`}>{status.enabled ? 'Activado' : 'Sin configurar'}</span></SettingsRow>
        <SettingsRow label="Último respaldo" detail={status.lastSuccess ? date(status.lastSuccess.createdAt) : 'Todavía no hay una copia guardada.'}>
          {status.lastSuccess && <a className="settings-button" href="/api/backups?download=latest">Descargar</a>}
        </SettingsRow>
        {status.retainedCopies !== undefined && <SettingsRow label="Copias en esta PC"><span className="settings-value">{status.retainedCopies}</span></SettingsRow>}
        {(busy || status.running) && <SettingsRow label="Guardando respaldo"><span className="settings-badge" role="status">En curso</span></SettingsRow>}
        {status.lastError && <div className="settings-editor"><SettingsNotice error>El último respaldo no se completó.</SettingsNotice></div>}
        {posProfile.id === 'smoothies' && <>
          <SettingsRow label="Copia en destino externo" detail={!status.externalCopy?.configured
            ? 'Pendiente: falta elegir el dispositivo o destino externo.'
            : status.externalCopy.state === 'copied' && status.externalCopy.lastSuccess
              ? `Última copia verificada: ${date(status.externalCopy.lastSuccess.createdAt)}`
              : status.externalCopy.state === 'failed' ? 'El respaldo local se conserva. Revisa el destino externo.' : 'Pendiente de copiar el último respaldo.'}>
            <span className={`settings-badge${status.externalCopy?.state === 'copied' ? ' is-on' : ''}`}>{status.externalCopy?.state === 'copied' ? 'Verificada' : status.externalCopy?.state === 'failed' ? 'Requiere revisión' : 'Pendiente'}</span>
          </SettingsRow>
          {status.externalCopy?.lastError && <div className="settings-editor"><SettingsNotice error>{status.externalCopy.lastError}</SettingsNotice></div>}
        </>}
        {status.enabled && <div className="settings-editor"><div><button type="button" className="is-primary" disabled={busy || status.running} onClick={() => void run()}>Crear respaldo</button></div></div>}
        <details className="settings-details"><summary>Información del respaldo</summary><div>
          <p>Las copias están cifradas. Guarda la clave de recuperación por separado.</p>
          {posProfile.id === 'smoothies' && <p>La copia externa contiene solo el archivo cifrado. Su clave se conserva por separado. Verificar el archivo no sustituye una restauración de prueba ni confirma que el destino esté fuera de esta PC.</p>}
          {posProfile.id === 'smoothies' &&
            <p>La copia incluye los datos del POS, las fotos subidas al catálogo y el registro local de impresión.</p>}
          {status.lastSuccess && <p>Tamaño: {(status.lastSuccess.bytes / 1024 / 1024).toFixed(2)} MB</p>}
          {status.lastAttemptAt && <p>Último intento: {date(status.lastAttemptAt)}</p>}
          {status.message && <p>{status.message}</p>}
          {status.lastError && <p>{status.lastError}</p>}
          {status.retainedBytes !== undefined && <p>Espacio usado: {(status.retainedBytes / 1024 / 1024).toFixed(2)} MB</p>}
        </div></details>
      </SettingsGroup>
    </>}
  </div>;
}
