import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function seal(payload, key) {
  assert.equal(key.length, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('pos-cafe-local-recovery-v1'));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: bytes.toString('base64') };
}
export function unseal(envelope, key) {
  assert.equal(envelope.version, 1, 'Unsupported backup envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from('pos-cafe-local-recovery-v1'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  for (const file of Object.values(payload.files)) assert.equal(sha256(Buffer.from(file.base64, 'base64')), file.sha256, 'Backup member integrity mismatch');
  return payload;
}
export function restoreTarget(container, runId, database) {
  assert.match(runId, /^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  assert.equal(container.Name, `/pos-cafe-recovery-${runId.slice(0, 8)}-db`);
  assert.equal(container.Config.Labels?.['pos-cafe.recovery'], runId);
  assert.equal(database, 'restored_pos');
  const bindings = container.NetworkSettings.Ports['5432/tcp'];
  assert.ok(bindings?.length);
  for (const binding of bindings) {
    assert.equal(binding.HostIp, '127.0.0.1'); assert.equal(binding.HostPort, '55462');
  }
}
export function allowDatabaseRewind(saved, current) {
  assert.equal(current.business, saved.business, 'Database rewind refused: business records changed after backup');
  assert.equal(current.auth, saved.auth, 'Database rewind refused: Auth records changed after backup');
}
export function allowAppRollback(release, databaseContract) {
  assert.equal(release.contract, databaseContract, 'App rollback refused: incompatible database contract');
  assert.ok(release.buildId && release.artifactHash, 'A verified retained production artifact is required');
}
