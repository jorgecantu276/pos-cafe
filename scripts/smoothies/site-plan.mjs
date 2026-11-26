import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lanOrigin } from '../customer/lan.mjs';

const testCases = [
  ['device-trust', 'PC e iPad aceptan la autoridad y Safari abre HTTPS sin avisos'],
  ['login', 'Iniciar sesión desde Safari con la cuenta del negocio'],
  ['menu-import', 'Importar el JSON aprobado sin duplicados y revisar productos y extras'],
  ['opening-counts', 'Confirmar existencias físicas; no confundir previsto con contado'],
  ['recipe-menu', 'Guardar prueba privada, crear borrador y activar explícitamente'],
  ['cash-sale', 'Cobrar efectivo y reconciliar total, cambio, folio e inventario'],
  ['reconnect', 'Reconectar Wi-Fi y reabrir Safari conservando una sola venta'],
  ['internet-loss', 'Cobrar con internet desconectado y Wi-Fi local activa'],
  ['pc-restart', 'Reiniciar Windows y acceder a la misma instalación desde Safari'],
  ['physical-print', 'Confirmar las copias físicas requeridas y sus colas'],
  ['external-backup', 'Verificar copia cifrada en otro dispositivo y clave por separado'],
  ['full-restore', 'Restaurar copia en destino aislado y verificar fotos, ventas y diario'],
  ['compatible-update', 'Aceptar actualización firmada y recuperación de arranque con datos retenidos'],
];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => value === null || (typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 1024 && !/[\r\n\u0000<>]/.test(value));
const decision = value => value === null || typeof value === 'boolean';
const localPath = value => typeof value === 'string' && path.isAbsolute(value) && !/^(?:\\\\|\/\/)/.test(value);
const sourceRoot = path.resolve(import.meta.dirname, '../..');
async function privateFile(filename, existing = false) {
  assert.ok(localPath(filename), 'Indica una ruta absoluta fuera del paquete para los datos privados.');
  const root = await realpath(sourceRoot), target = existing ? await realpath(filename) : path.join(await realpath(path.dirname(filename)), path.basename(filename));
  const packageRoot = path.dirname(root);
  const packaged = await lstat(path.join(packageRoot, 'release.json')).then(info => info.isFile()).catch(() => false);
  for (const protectedRoot of packaged ? [root, packageRoot] : [root]) {
    const relative = path.relative(protectedRoot, target);
    assert.ok(path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`), 'Conserva los datos reales fuera del codigo y del paquete.');
  }
}

/** Null means a live fact has not been supplied. It never means accepted or zero. */
export function validateSite(site) {
  assert.ok(object(site) && site.protocol === 1 && site.product === 'smoothies', 'Usa la ficha de sitio de POS Smoothies versión 1.');
  const sections = { pc: ['windowsVersion', 'lanAddress'], ipad: ['model', 'ipadOsVersion'],
    network: ['port', 'samePrivateNetworkConfirmed'], backup: ['externalDirectory', 'separateDeviceConfirmed', 'recoveryKeyStoredSeparately'],
    printing: ['required', 'model', 'connection'], menu: ['intakeJson', 'approved', 'openingCountsConfirmed'] };
  assert.deepEqual(Object.keys(site).sort(), ['protocol', 'product', ...Object.keys(sections)].sort(), 'La ficha no admite claves, contraseñas ni campos ajenos.');
  for (const [name, keys] of Object.entries(sections)) {
    assert.ok(object(site[name]), `Falta ${name}.`);
    assert.deepEqual(Object.keys(site[name]).sort(), keys.sort(), `Revisa los campos de ${name}.`);
  }
  for (const value of [site.pc.windowsVersion, site.pc.lanAddress, site.ipad.model, site.ipad.ipadOsVersion,
    site.backup.externalDirectory, site.printing.model, site.printing.connection, site.menu.intakeJson]) assert.ok(text(value), 'Usa null para un valor pendiente o un dato real, sin marcadores de ejemplo.');
  for (const value of [site.network.samePrivateNetworkConfirmed, site.backup.separateDeviceConfirmed,
    site.backup.recoveryKeyStoredSeparately, site.printing.required, site.menu.approved, site.menu.openingCountsConfirmed]) assert.ok(decision(value), 'Las confirmaciones deben ser true, false o null.');
  assert.ok(Number.isInteger(site.network.port) && site.network.port >= 1024 && site.network.port <= 65535
    && ![3180, 58000, 55432].includes(site.network.port), 'Usa un puerto HTTPS distinto de los servicios internos.');
  if (site.pc.lanAddress !== null) {
    const origin = lanOrigin(`https://${site.pc.lanAddress}:${site.network.port}`);
    assert.equal(origin.address, site.pc.lanAddress, 'Indica solo la IPv4 privada de la PC.');
  }
  for (const value of [site.backup.externalDirectory, site.menu.intakeJson]) if (value !== null) assert.ok(localPath(value), 'Usa rutas absolutas locales; no enlaces web ni rutas de red.');
  return site;
}

export async function readSite(filename) {
  assert.ok(localPath(filename), 'Indica la ruta absoluta de la ficha privada.');
  const info = await lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 64 * 1024, 'Usa una ficha JSON privada de tamaño válido.');
  await privateFile(filename, true);
  return validateSite(JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, '')));
}

export function sitePlan(site, { requireAddress = false } = {}) {
  validateSite(site);
  if (requireAddress) assert.ok(site.pc.lanAddress, 'Falta la IP privada real de la PC; no se ha configurado ni aceptado el sitio.');
  const pending = [];
  for (const [key, value] of Object.entries({ 'pc.windowsVersion': site.pc.windowsVersion, 'pc.lanAddress': site.pc.lanAddress,
    'ipad.model': site.ipad.model, 'ipad.ipadOsVersion': site.ipad.ipadOsVersion,
    'network.samePrivateNetworkConfirmed': site.network.samePrivateNetworkConfirmed,
    'backup.externalDirectory': site.backup.externalDirectory, 'backup.separateDeviceConfirmed': site.backup.separateDeviceConfirmed,
    'backup.recoveryKeyStoredSeparately': site.backup.recoveryKeyStoredSeparately, 'printing.required': site.printing.required,
    'menu.intakeJson': site.menu.intakeJson, 'menu.approved': site.menu.approved, 'menu.openingCountsConfirmed': site.menu.openingCountsConfirmed })) {
    if (value === null || value === false) pending.push(key);
  }
  // Choosing no physical printer is a valid business choice, not an unmet test.
  if (site.printing.required === false) pending.splice(pending.indexOf('printing.required'), 1);
  if (site.printing.required === true) for (const key of ['model', 'connection']) if (!site.printing[key]) pending.push(`printing.${key}`);
  return { protocol: 1, product: 'smoothies', siteSha256: createHash('sha256').update(JSON.stringify(site)).digest('hex'),
    lanAddress: site.pc.lanAddress, lanPort: site.network.port, backupExportDirectory: site.backup.externalDirectory,
    configurationReady: Boolean(site.pc.lanAddress), liveAcceptance: 'pending', pending };
}

/** @param {any} site @param {string|null} [packageId] */
export function liveChecklist(site, packageId = null) {
  const plan = sitePlan(site);
  assert.ok(packageId === null || /^[a-f0-9]{16}$/.test(packageId), 'Identidad de paquete inválida.');
  return { protocol: 1, product: 'smoothies', siteSha256: plan.siteSha256, packageId,
    deviceIdentity: { windowsVersion: site.pc.windowsVersion, ipadModel: site.ipad.model, ipadOsVersion: site.ipad.ipadOsVersion },
    pendingValues: plan.pending,
    observations: testCases.map(([id, description]) => ({ id, description,
      result: id === 'physical-print' && site.printing.required === false ? 'not-required' : 'pending',
      observedAt: null, observedBy: null, evidence: null })),
  };
}

async function main() {
  const [action, filename, output, packageId] = process.argv.slice(2);
  if (action === 'init') {
    await privateFile(filename);
    const template = await readFile(path.join(import.meta.dirname, '../../config/smoothies-site.example.json'));
    await writeFile(filename, template, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ initialized: true, liveAcceptance: 'pending' })); return;
  }
  const site = await readSite(filename);
  if (action === 'inspect' || action === 'install') {
    assert.ok(!output && !packageId, 'Argumentos de ficha inválidos.');
    console.log(JSON.stringify(sitePlan(site, { requireAddress: action === 'install' }))); return;
  }
  assert.equal(action, 'checklist', 'Usa init, inspect, install o checklist.');
  assert.ok(localPath(output), 'Indica una ruta absoluta nueva para la lista de aceptación.');
  await privateFile(output);
  await writeFile(output, JSON.stringify(liveChecklist(site, packageId || null), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ created: true, liveAcceptance: 'pending' }));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
