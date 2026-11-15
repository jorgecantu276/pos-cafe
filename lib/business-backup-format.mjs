import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const header=Buffer.from('POS-CAFE-BACKUP-1\n');
export const maximumBackupBytes=256*1024*1024;
export const maximumAssetBytes=150*1024*1024;
export const maximumPhotoBytes=5*1024*1024;
export const photoName=/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
export const journalNames=['mock-jobs.sqlite','windows-jobs.sqlite'];
export const backupFilename=/^backup-\d{8}T\d{9}Z-[0-9a-f-]{36}\.posbackup$/;
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const requiredBackupTables=[
  'public.cash_registers','public.categories','public.coupons','public.customers','public.extras','public.modifier_groups','public.modifier_options',
  'public.order_item_modifiers','public.order_items','public.orders','public.product_modifier_groups','public.products','public.profiles','public.shifts',
  'auth.users','auth.identities','cafe_private.abandoned_checkouts','cafe_private.shift_expense_requests','cafe_private.drawer_settings',
  'cafe_private.drawer_requests','cafe_private.drawer_handoffs','cafe_private.register_shortcuts','cafe_private.register_shortcut_requests',
];

export function validateBusinessSnapshot(snapshot) {
  if(!object(snapshot)||snapshot.format!=='pos-cafe-business-snapshot-v1'||!Number.isFinite(Date.parse(snapshot.snapshot_at))
    ||!object(snapshot.tables)||!object(snapshot.sequences)) throw Error('El respaldo no contiene una captura válida.');
  for(const required of requiredBackupTables)
    if(!Object.hasOwn(snapshot.tables,required)) throw Error('El respaldo está incompleto.');
  for(const [name,table] of Object.entries(snapshot.tables)) {
    if(!/^(public|cafe_private)\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)&&!['auth.users','auth.identities'].includes(name)) throw Error('Tabla de respaldo inválida.');
    if(!object(table)||!Array.isArray(table.columns)||!table.columns.length||!Array.isArray(table.rows)
      ||table.columns.some(column=>!object(column)||typeof column.name!=='string'||typeof column.type!=='string')
      ||table.rows.some(row=>!object(row)||table.columns.some(column=>!Object.hasOwn(row,column.name)))) throw Error('Tabla de respaldo incompleta.');
  }
  for(const name of ['public.orders_folio_seq','public.orders_ticket_number_seq'])
    if(!Object.hasOwn(snapshot.sequences,name)) throw Error('Faltan secuencias de folios en el respaldo.');
  for(const [name,sequence] of Object.entries(snapshot.sequences))
    if(!/^(public|cafe_private)\.[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)||!object(sequence)
      ||!/^\d+$/.test(String(sequence.last_value))||typeof sequence.is_called!=='boolean') throw Error('Secuencia de respaldo inválida.');
  return snapshot;
}

export function validateBusinessArchive(archive) {
  if(!object(archive)||archive.format!=='pos-cafe-business-backup'||archive.version!==1
    ||!Number.isFinite(Date.parse(archive.createdAt))||typeof archive.releaseCommit!=='string'
    ||!object(archive.contract)||!object(archive.contract.files)) throw Error('Formato de respaldo inválido.');
  // Keep the database's original JSON text. Parsing/re-serializing its rows in
  // JavaScript could round bigint/numeric values before a future recovery.
  if(typeof archive.snapshotJson!=='string') throw Error('Falta la captura original de la base de datos.');
  let snapshot;
  try { snapshot=JSON.parse(archive.snapshotJson); } catch { throw Error('Captura de respaldo ilegible.'); }
  validateBusinessSnapshot(snapshot);
  const names=Object.keys(archive.contract.files).sort();
  if(!names.includes('schema.snapshot.json')||!names.some(name=>/^migrations\/\d+_[a-zA-Z0-9_]+\.sql$/.test(name))) throw Error('Falta el contrato de la base de datos.');
  for(const [name,file] of Object.entries(archive.contract.files)) {
    if(name!=='schema.snapshot.json'&&!/^migrations\/\d+_[a-zA-Z0-9_]+\.sql$/.test(name)) throw Error('Archivo de contrato inválido.');
    if(!object(file)||typeof file.content!=='string'||file.sha256!==sha256(Buffer.from(file.content))) throw Error('El contrato de la base de datos está dañado.');
  }
  // Older accepted archives remain readable with their own recorded contract.
  // A release claiming 019 must actually include its durable phone state.
  if(names.includes('migrations/202611020019_phone_orders.sql')) {
    for(const required of ['public.pos_phone_orders','cafe_private.phone_requests','cafe_private.inventory_reservations'])
      if(!Object.hasOwn(snapshot.tables,required)) throw Error('El respaldo no incluye todos los pedidos por teléfono y sus reservas.');
    if(!Object.hasOwn(snapshot.sequences,'public.pos_phone_orders_folio_seq')) throw Error('Falta la secuencia de pedidos por teléfono.');
  }
  if(names.includes('migrations/202611020020_delivery_readiness.sql')) {
    for(const required of ['cafe_private.staff_status_requests','cafe_private.catalog_requests'])
      if(!Object.hasOwn(snapshot.tables,required)) throw Error('El respaldo no incluye los guardados de reactivación.');
    for(const [relation,column] of [['public.products','catalog_revision'],['public.extras','catalog_revision'],['public.profiles','management_revision']])
      if(!snapshot.tables[relation]?.columns.some(field=>field.name===column)) throw Error('El respaldo no incluye las revisiones de catálogo y equipo.');
  }
  try {
    const schema=JSON.parse(archive.contract.files['schema.snapshot.json'].content);
    if(!object(schema)||!Array.isArray(schema.tables)||!Array.isArray(schema.sequences)) throw Error();
    for(const table of schema.tables) if(!object(table)||typeof table.name!=='string'||!Object.hasOwn(snapshot.tables,`public.${table.name}`)) throw Error();
    for(const sequence of schema.sequences) if(!object(sequence)||typeof sequence.name!=='string'
      ||!Object.hasOwn(snapshot.sequences,`${sequence.schema||'public'}.${sequence.name}`)) throw Error();
  }
  catch { throw Error('El esquema del respaldo es inválido.'); }
  if (archive.assets !== undefined) {
    if (!object(archive.assets) || archive.assets.version !== 1 || !Array.isArray(archive.assets.files))
      throw Error('Formato de archivos locales inválido.');
    const paths = new Set();
    let total = 0;
    for (const file of archive.assets.files) {
      if (!object(file) || !['photos','print'].includes(file.kind) || typeof file.name !== 'string'
        || !(file.kind === 'photos' ? photoName.test(file.name) : journalNames.includes(file.name))
        || typeof file.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
        || file.base64.length % 4 !== 0 || paths.has(`${file.kind}/${file.name}`))
        throw Error('El respaldo contiene un archivo local inválido.');
      const bytes = Buffer.from(file.base64, 'base64');
      total += bytes.length;
      if (!bytes.length || total > maximumAssetBytes || (file.kind === 'photos' && bytes.length > maximumPhotoBytes)
        || sha256(bytes) !== file.sha256) throw Error('No se pudo verificar un archivo local del respaldo.');
      paths.add(`${file.kind}/${file.name}`);
    }
  }
  return archive;
}

export function encryptBusinessArchive(archive,key) {
  if(!Buffer.isBuffer(key)||key.length!==32) throw Error('La clave de recuperación debe contener 32 bytes.');
  validateBusinessArchive(archive);
  const plaintext=Buffer.from(JSON.stringify(archive));
  if(plaintext.length>maximumBackupBytes) throw Error('El respaldo supera el tamaño admitido.');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(header);
  const encrypted=Buffer.concat([cipher.update(gzipSync(plaintext)),cipher.final()]);
  return Buffer.concat([header,nonce,cipher.getAuthTag(),encrypted]);
}

export function decryptBusinessArchive(bytes,key) {
  if(!Buffer.isBuffer(key)||key.length!==32||!Buffer.isBuffer(bytes)||bytes.length<header.length+29
    ||bytes.length>maximumBackupBytes||!bytes.subarray(0,header.length).equals(header)) throw Error('Archivo o clave de respaldo inválidos.');
  let archive;
  try {
    const start=header.length,decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(start,start+12));
    decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(start+12,start+28));
    const compressed=Buffer.concat([decipher.update(bytes.subarray(start+28)),decipher.final()]);
    archive=JSON.parse(gunzipSync(compressed,{maxOutputLength:maximumBackupBytes}).toString('utf8'));
  } catch { throw Error('No se pudo verificar el respaldo. Revisa el archivo y su clave de recuperación.'); }
  return validateBusinessArchive(archive);
}
