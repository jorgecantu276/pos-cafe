import assert from 'node:assert/strict';

// Synthetic successor only; never a published family version or reused label.
export function nextAcceptanceVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
  assert.ok(match, 'Acceptance baseline must use the supported stable/rc version format.');
  const [, major, minor, patch, rc] = match;
  return rc === undefined
    ? `${major}.${minor}.${Number(patch) + 1}-rc.1`
    : `${major}.${minor}.${patch}-rc.${Number(rc) + 1}`;
}
