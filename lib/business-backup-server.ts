import { posProfile } from './pos-profile';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { backupFilename, decryptBusinessArchive, encryptBusinessArchive, maximumBackupBytes, sha256, validateBusinessSnapshot } from './business-backup-format.mjs';
import { AccessError, isAuthUnavailable, requireAdministrator } from './user-management';
import { withDeadline } from './request-deadline';
import type { SupabaseClient } from '@supabase/supabase-js';
import { collectSmoothiesAssets } from './smoothies-backup-assets.mjs';
import { requestOriginMatches } from './request-origin';
import { backupDestinationId, exportBusinessBackup } from './business-backup-export.mjs';

interface BackupConfig { directory: string; keyFile: string; contractDirectory: string; releaseCommit: string; url: string; serviceKey: string; printDirectory?: string; exportDirectory?: string }
export interface BackupSuccess { createdAt: string; filename: string; bytes: number; sha256: string }
export interface BackupExternalCopy { configured: boolean; state: 'pending' | 'copied' | 'failed'; destinationId?: string; lastAttemptAt?: string; lastSuccess?: BackupSuccess; lastError?: string }
interface StoredStatus { version: 1; lastAttemptAt?: string; lastSuccess?: BackupSuccess; lastError?: string; externalCopy?: BackupExternalCopy }
export interface BackupStatus extends StoredStatus { enabled: boolean; running: boolean; message?: string; retainedCopies?: number; retainedBytes?: number }
interface BackupDependencies {
  config?: () => BackupConfig | null;
  snapshot?: (config: BackupConfig) => Promise<string>;
  now?: () => Date;
}

const stateKey = Symbol.for('pos-cafe.business-backups.v1');
type ProcessState = { running?: Promise<BackupStatus>; timer?: ReturnType<typeof setInterval>; lastError?: string };
const globals = globalThis as typeof globalThis & { [stateKey]?: ProcessState };
const state = globals[stateKey] ??= {};
const unavailable = 'El respaldo no se completó. Revisa la conexión, el espacio disponible y la configuración con el responsable.';
const retentionCopies = 14, retentionBytes = 512 * 1024 * 1024;
const inside = (child: string, parent: string) => { const relative = path.relative(parent, child); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

export function businessBackupConfig(): BackupConfig | null {
  const directory = process.env.POS_BACKUP_DIR, keyFile = process.env.POS_BACKUP_KEY_FILE, contractDirectory = process.env.POS_DATABASE_CONTRACT_DIR;
  if (!directory && !keyFile && !contractDirectory) return null;
  if (!directory || !keyFile || !contractDirectory || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Falta completar la configuración de respaldos del servidor.');
  const resolved = { directory: path.resolve(directory), keyFile: path.resolve(keyFile), contractDirectory: path.resolve(contractDirectory) };
  if (![directory, keyFile, contractDirectory].every(value => path.isAbsolute(value))
    || inside(resolved.keyFile, resolved.directory) || inside(resolved.directory, process.cwd()) || inside(resolved.keyFile, process.cwd()))
    throw new Error('Guarda los respaldos y su clave en carpetas externas a la versión, con la clave fuera de los respaldos.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const printDirectory = posProfile.id === 'smoothies' ? process.env.POS_PRINT_DATA_DIR : undefined;
  if (posProfile.id === 'smoothies' && (!printDirectory || !path.isAbsolute(printDirectory)))
    throw Error('Falta configurar la carpeta del registro de impresión.');
  const exportDirectory = posProfile.id === 'smoothies' ? process.env.POS_BACKUP_EXPORT_DIR || undefined : undefined;
  return { ...resolved, releaseCommit: process.env.POS_RELEASE_COMMIT || 'sin-identificador', url, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY, printDirectory, exportDirectory };
}

function validSuccess(value: unknown): value is BackupSuccess {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt)) && typeof row.filename === 'string'
    && backupFilename.test(row.filename) && typeof row.bytes === 'number' && row.bytes > 0 && row.bytes <= maximumBackupBytes
    && typeof row.sha256 === 'string' && /^[a-f0-9]{64}$/.test(row.sha256);
}

function validExternalCopy(value: unknown): value is BackupExternalCopy {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.configured === 'boolean' && ['pending', 'copied', 'failed'].includes(String(row.state))
    && (row.destinationId === undefined || typeof row.destinationId === 'string' && /^[a-f0-9]{64}$/.test(row.destinationId))
    && (row.lastAttemptAt === undefined || typeof row.lastAttemptAt === 'string' && Number.isFinite(Date.parse(row.lastAttemptAt)))
    && (row.lastSuccess === undefined || validSuccess(row.lastSuccess)) && (row.lastError === undefined || typeof row.lastError === 'string');
}

function externalCopyStatus(config: BackupConfig, status: StoredStatus): BackupExternalCopy {
  if (!config.exportDirectory) return { configured: false, state: 'pending' };
  const destinationId = backupDestinationId(config.exportDirectory), previous = status.externalCopy;
  if (!validExternalCopy(previous) || previous.destinationId !== destinationId) return { configured: true, state: 'pending', destinationId };
  if (previous.state === 'copied' && (previous.lastSuccess?.sha256 !== status.lastSuccess?.sha256 || previous.lastSuccess?.bytes !== status.lastSuccess?.bytes))
    return { ...previous, state: 'pending', configured: true, lastError: undefined };
  return { ...previous, configured: true };
}

async function readStatus(config: BackupConfig): Promise<StoredStatus> {
  try {
    const filename = path.join(config.directory, 'status.json');
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) throw Error();
    const raw = JSON.parse(await readFile(filename, 'utf8')) as StoredStatus;
    if (raw.version !== 1 || (raw.lastSuccess !== undefined && !validSuccess(raw.lastSuccess))
      || (raw.lastAttemptAt !== undefined && !Number.isFinite(Date.parse(raw.lastAttemptAt)))
      || (raw.lastError !== undefined && typeof raw.lastError !== 'string')) throw Error();
    // A malformed external-copy record must not disable otherwise verified
    // local backups. It is retried through the same scheduled backup operation.
    if (raw.externalCopy !== undefined && !validExternalCopy(raw.externalCopy)) delete raw.externalCopy;
    return raw;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1 };
    throw new Error('No se pudo verificar el estado local de respaldos. Conserva los archivos y pide revisión.');
  }
}

// Publish only a complete, flushed temporary file. Never truncate the previous
// good archive or status file, even after a network, disk or process failure.
async function atomicWrite(filename: string, bytes: Uint8Array) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600); await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
    await rename(temporary, filename);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function finishExternalCopy(config: BackupConfig, stored: StoredStatus, now: Date): Promise<StoredStatus> {
  const previous = externalCopyStatus(config, stored);
  if (!config.exportDirectory || !stored.lastSuccess) return { ...stored, externalCopy: previous };
  if (previous.state === 'copied' && previous.lastSuccess?.sha256 === stored.lastSuccess.sha256 && previous.lastSuccess.bytes === stored.lastSuccess.bytes)
    return { ...stored, externalCopy: previous };
  let externalCopy: BackupExternalCopy = { ...previous, lastAttemptAt: now.toISOString() };
  try {
    const lastSuccess = await exportBusinessBackup({ ...config, exportDirectory: config.exportDirectory }, stored.lastSuccess);
    externalCopy = { configured: true, state: 'copied', destinationId: previous.destinationId, lastAttemptAt: now.toISOString(), lastSuccess };
  } catch {
    externalCopy = { ...externalCopy, state: 'failed', lastError: 'El respaldo local está guardado; no se confirmó su copia externa. Revisa el destino, la conexión y el espacio disponible.' };
  }
  const result = { ...stored, externalCopy };
  try { await atomicWrite(path.join(config.directory, 'status.json'), Buffer.from(JSON.stringify(result))); }
  catch { result.externalCopy = { ...externalCopy, state: 'failed', lastError: 'El respaldo local está guardado; no se pudo registrar el resultado de la copia externa.' }; }
  return result;
}

async function recoveryKey(config: BackupConfig, established: boolean) {
  await mkdir(config.directory, { recursive: true }); await mkdir(path.dirname(config.keyFile), { recursive: true });
  const [directory, keyParent] = await Promise.all([realpath(config.directory), realpath(path.dirname(config.keyFile))]);
  const keyPath = path.join(keyParent, path.basename(config.keyFile));
  const release = await realpath(process.cwd());
  if (inside(keyPath, directory) || inside(directory, release) || inside(keyPath, release)) throw Error('Ruta de respaldo o clave inválida.');
  try {
    const info = await lstat(config.keyFile);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== 32) throw Error('Clave de recuperación inválida.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Missing an established key must never silently create an unusable new
    // key. Initialization is permitted only before this directory has archives.
    if (established || (await readdir(config.directory)).some(name => backupFilename.test(name))) throw Error('Falta la clave original de recuperación.');
    const file = await open(config.keyFile, 'wx', 0o600);
    try { await file.writeFile(randomBytes(32)); await file.sync(); } finally { await file.close(); }
  }
  const key = await readFile(config.keyFile);
  if (key.length !== 32) throw Error('Clave de recuperación inválida.');
  return key;
}

async function databaseContract(config: BackupConfig) {
  const entries = await readdir(config.contractDirectory);
  // The Windows release ships all SQL files beside schema.snapshot.json;
  // a source-tree contract directory can instead contain migrations/.
  const nested = entries.includes('migrations');
  const migrationDirectory = nested ? path.join(config.contractDirectory, 'migrations') : config.contractDirectory;
  const profileDirectory = path.join(config.contractDirectory, 'smoothies');
  const directories = config.printDirectory ? [migrationDirectory, profileDirectory] : [migrationDirectory];
  const migrations = (await Promise.all(directories.map(async directory => (await readdir(directory))
    .filter(name => /^\d+_[a-zA-Z0-9_]+\.sql$/.test(name)).map(name => [name, directory] as const)))).flat();
  if (!migrations.some(([name]) => name === '202610300012_business_backups.sql')) throw Error('Falta el contrato de respaldos de esta versión.');
  const files: Record<string, { content: string; sha256: string }> = {};
  for (const [name, file] of [['schema.snapshot.json', path.join(config.contractDirectory, 'schema.snapshot.json')],
    ...migrations.map(([name, directory]) => [`migrations/${name}`, path.join(directory, name)])]) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw Error('Contrato de base de datos inválido.');
    const content = await readFile(file, 'utf8'); files[name] = { content, sha256: sha256(Buffer.from(content)) };
  }
  return { files };
}

async function readSnapshot(config: BackupConfig): Promise<string> {
  const client = createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }) } });
  const { data, error } = await client.rpc('pos_business_backup');
  if (error || typeof data !== 'string' || Buffer.byteLength(data) > maximumBackupBytes) throw Error(unavailable);
  validateBusinessSnapshot(JSON.parse(data));
  return data;
}

const localDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Matamoros', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function businessBackupDue(lastSuccess: BackupSuccess | undefined, now = new Date()) {
  return !lastSuccess || localDay(new Date(lastSuccess.createdAt)) !== localDay(now);
}

async function retainGoodArchives(config: BackupConfig, latest: BackupSuccess) {
  const files = [];
  for (const name of (await readdir(config.directory)).filter(name => backupFilename.test(name))) {
    const info = await lstat(path.join(config.directory, name));
    if (info.isFile() && !info.isSymbolicLink()) files.push({ name, size: info.size });
  }
  files.sort((a, b) => b.name.localeCompare(a.name));
  let count = 1, bytes = latest.bytes;
  for (const file of files) {
    if (file.name === latest.filename) continue;
    if (count < retentionCopies && bytes + file.size <= retentionBytes) { count++; bytes += file.size; }
    else await unlink(path.join(config.directory, file.name));
  }
}

async function retainedSize(config: BackupConfig) {
  let retainedCopies = 0, retainedBytes = 0;
  try {
    for (const name of (await readdir(config.directory)).filter(name => backupFilename.test(name))) {
      const info = await lstat(path.join(config.directory, name));
      if (info.isFile() && !info.isSymbolicLink()) { retainedCopies++; retainedBytes += info.size; }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return { retainedCopies, retainedBytes };
}

export async function businessBackupStatus(dependencies: BackupDependencies = {}): Promise<BackupStatus> {
  try {
    const config = (dependencies.config ?? businessBackupConfig)();
    if (!config) return { version: 1, enabled: false, running: false, message: 'El respaldo automático todavía no está configurado en esta PC.' };
    const status = await readStatus(config);
    return { ...status, externalCopy: externalCopyStatus(config, status), ...await retainedSize(config), lastError: state.lastError ?? status.lastError, enabled: true, running: Boolean(state.running) };
  } catch (error) { return { version: 1, enabled: false, running: false, message: error instanceof Error ? error.message : 'Configuración de respaldos no disponible.' }; }
}

export async function runBusinessBackup(force = false, dependencies: BackupDependencies = {}): Promise<BackupStatus> {
  if (state.running) return state.running;
  const operation = async (): Promise<BackupStatus> => {
    const config = (dependencies.config ?? businessBackupConfig)();
    if (!config) throw new AccessError('El respaldo automático no está configurado.', 503);
    const previous = await readStatus(config), now = (dependencies.now ?? (() => new Date()))();
    if (!force && !businessBackupDue(previous.lastSuccess, now)) return { ...await finishExternalCopy(config, previous, now), enabled: true, running: false };
    const lastAttemptAt = now.toISOString();
    try {
      const key = await recoveryKey(config, Boolean(previous.lastSuccess));
      if (previous.lastSuccess) decryptBusinessArchive((await downloadBusinessBackup({ config: () => config })).bytes, key);
      const contract = await databaseContract(config);
      const snapshotJson = await (dependencies.snapshot ?? readSnapshot)(config);
      const assets = config.printDirectory ? await collectSmoothiesAssets({ ...config, printDirectory: config.printDirectory }, snapshotJson) : undefined;
      const archive = { format: 'pos-cafe-business-backup', version: 1, createdAt: lastAttemptAt, releaseCommit: config.releaseCommit,
        sourceHost: new URL(config.url).hostname, snapshotJson, contract, assets, excluded: assets
          ? ['external-photo-links', 'supabase-platform-configuration']
          : ['local-print-journal', 'supabase-storage-files', 'supabase-platform-configuration'] };
      const bytes = encryptBusinessArchive(archive, key);
      decryptBusinessArchive(bytes, key); // Read-back verification before publication.
      const filename = `backup-${lastAttemptAt.replace(/[-:.]/g, '')}-${randomUUID()}.posbackup`;
      const file = path.join(config.directory, filename);
      await atomicWrite(file, bytes);
      // Confirm the published bytes as well, before changing last-success.
      if (sha256(await readFile(file)) !== sha256(bytes)) throw Error(unavailable);
      const lastSuccess: BackupSuccess = { filename, createdAt: lastAttemptAt, bytes: bytes.length, sha256: sha256(bytes) };
      const stored: StoredStatus = { version: 1, lastAttemptAt, lastSuccess, externalCopy: previous.externalCopy };
      await atomicWrite(path.join(config.directory, 'status.json'), Buffer.from(JSON.stringify(stored)));
      state.lastError = undefined;
      // Retention runs only after publication; unrelated files and symlinks
      // are never deleted. A cleanup failure does not undo a good backup.
      await retainGoodArchives(config, lastSuccess).catch(() => { state.lastError = 'El respaldo se guardó; el responsable debe revisar la limpieza de copias antiguas.'; });
      return { ...await finishExternalCopy(config, stored, now), lastError: state.lastError, enabled: true, running: false };
    } catch {
      state.lastError = unavailable;
      await atomicWrite(path.join(config.directory, 'status.json'), Buffer.from(JSON.stringify({ ...previous, lastAttemptAt, lastError: unavailable }))).catch(() => {});
      throw new AccessError(unavailable, 503);
    }
  };
  state.running = operation();
  try { return await state.running; } finally { state.running = undefined; }
}

export async function downloadBusinessBackup(dependencies: BackupDependencies = {}) {
  const config = (dependencies.config ?? businessBackupConfig)();
  if (!config) throw new AccessError('El respaldo automático no está configurado.', 503);
  const latest = (await readStatus(config)).lastSuccess;
  if (!latest) throw new AccessError('Todavía no hay un respaldo confirmado.', 404);
  const filename = path.join(config.directory, latest.filename), info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== latest.bytes) throw new AccessError('El último respaldo requiere revisión.', 503);
  const bytes = await readFile(filename);
  if (sha256(bytes) !== latest.sha256) throw new AccessError('El último respaldo requiere revisión.', 503);
  return { bytes, filename: latest.filename };
}

export function startBusinessBackupScheduler() {
  if (state.timer) return;
  const tick = () => { void runBusinessBackup().catch(() => { state.lastError = unavailable; }); };
  // Startup never blocks opening the register. Failed attempts are retried
  // every hour; successful backups run once per local calendar day.
  tick(); state.timer = setInterval(tick, 60 * 60 * 1000); state.timer.unref();
}

async function requireBackupStaff(caller: SupabaseClient) {
  const { data: { user }, error } = await withDeadline(() => caller.auth.getUser());
  if (isAuthUnavailable(error)) throw new AccessError('No se pudo comprobar el acceso.', 503);
  if (error || !user) throw new AccessError('Inicia sesión.', 401);
  const profile = await withDeadline(() => caller.from('profiles').select('role,is_active').eq('id', user.id).single());
  if (profile.error) throw new AccessError('No se pudo comprobar el acceso.', 503);
  if (!profile.data?.is_active || !['admin', 'cashier', 'barista'].includes(profile.data.role)) throw new AccessError('Sin acceso.', 403);
}

async function checkpointBusinessBackup() {
  const config = businessBackupConfig();
  if (!config) return;
  if (config.printDirectory) {
    // A start-of-day backup in progress when the cut was saved can predate
    // that cut, so wait for it before scheduling a new snapshot.
    if (state.running) await state.running.catch(() => {});
    return runBusinessBackup(true);
  }
  const success = (await readStatus(config)).lastSuccess;
  if (success && Date.now() - Date.parse(success.createdAt) < 60_000) return;
  return runBusinessBackup(true);
}

interface BackupOperations {
  status: () => Promise<BackupStatus>;
  run: () => Promise<BackupStatus>;
  download: () => Promise<{ bytes: Buffer; filename: string }>;
  checkpoint?: () => Promise<unknown>;
}

export async function handleBusinessBackupRequest(request: Request, caller: SupabaseClient, operations: BackupOperations = {
  status: businessBackupStatus, run: () => runBusinessBackup(true), download: downloadBusinessBackup, checkpoint: checkpointBusinessBackup,
}) {
  const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' };
  const url = new URL(request.url);
  if (process.env.POS_LAN_MODE === '1' && !requestOriginMatches(request)) throw new AccessError('Solicitud de respaldo inválida.', 400);
  if (request.method === 'GET') {
    await requireAdministrator(caller);
    if (url.searchParams.size === 0) return Response.json(await operations.status(), { headers });
    if (url.searchParams.size !== 1 || url.searchParams.get('download') !== 'latest') throw new AccessError('Solicitud de respaldo inválida.', 400);
    const result = await operations.download();
    return new Response(new Uint8Array(result.bytes), { headers: { ...headers, 'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${result.filename}"`, 'X-Content-Type-Options': 'nosniff' } });
  }
  const action = request.headers.get('X-Pos-Backup');
  if (request.method !== 'POST' || url.searchParams.size || !['1', 'checkpoint'].includes(action ?? '')
    || !requestOriginMatches(request)) throw new AccessError('Solicitud de respaldo inválida.', 400);
  if (action === 'checkpoint') {
    await requireBackupStaff(caller);
    void (operations.checkpoint ?? operations.run)().catch(() => { state.lastError = unavailable; });
    return Response.json({ accepted: true }, { status: 202, headers });
  }
  await requireAdministrator(caller);
  return Response.json(await operations.run(), { headers });
}
