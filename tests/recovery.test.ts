import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { seal, unseal, sha256, restoreTarget, allowDatabaseRewind, allowAppRollback } from '../scripts/recovery/artifacts.mjs';

test('backup envelope rejects corruption, wrong keys and inconsistent member hashes', () => {
  const key = randomBytes(32), data = Buffer.from('synthetic backup bytes');
  const payload = { files: { 'database.dump': { base64: data.toString('base64'), sha256: sha256(data) } } };
  const envelope = seal(payload, key);
  assert.deepEqual(unseal(envelope, key), payload);
  assert.throws(() => unseal(envelope, randomBytes(32)));
  const damaged = { ...envelope, ciphertext: `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}` };
  assert.throws(() => unseal(damaged, key));
  assert.throws(() => unseal(seal({ files: { a: { base64: data.toString('base64'), sha256: 'incorrect' } } }, key), key));
});

test('restore refuses source/unowned/nonlocal targets and rollback refuses data loss or old contracts', () => {
  const runId = randomUUID();
  const container = { Name: `/pos-cafe-recovery-${runId.slice(0, 8)}-db`, Config: { Labels: { 'pos-cafe.recovery': runId } },
    NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '55462' }] } } };
  restoreTarget(container, runId, 'restored_pos');
  assert.throws(() => restoreTarget({ ...container, Name: '/supabase_db_pos-cafe-staging-local' }, runId, 'restored_pos'));
  assert.throws(() => restoreTarget(container, runId, 'postgres'));
  assert.throws(() => restoreTarget({ ...container, Config: { Labels: {} } }, runId, 'restored_pos'));
  assert.throws(() => restoreTarget({ ...container, NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '55462' }] } } }, runId, 'restored_pos'));
  const saved = { business: 'original', auth: 'original' };
  allowDatabaseRewind(saved, saved);
  assert.throws(() => allowDatabaseRewind(saved, { ...saved, business: 'new-sale' }));
  assert.throws(() => allowDatabaseRewind(saved, { ...saved, auth: 'new-user' }));
  allowAppRollback({ contract: 'secure-v1', buildId: 'retained', artifactHash: 'verified' }, 'secure-v1');
  assert.throws(() => allowAppRollback({ contract: 'legacy', buildId: 'retained', artifactHash: 'verified' }, 'secure-v1'));
});
