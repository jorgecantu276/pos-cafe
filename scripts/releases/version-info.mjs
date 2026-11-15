import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const catalogPath = new URL('../../config/pos-versions.json', import.meta.url);
const appVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/;

export function posVersions() {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  return Object.fromEntries(Object.entries(catalog).map(([product, entry]) => {
    assert.match(product, /^[a-z]+$/);
    assert.ok(typeof entry.name === 'string' && entry.name.length > 0, 'Missing product name.');
    assert.match(entry.version, appVersionPattern, 'Use X.Y.Z or X.Y.Z-rc.N.');
    assert.ok(['Local candidate', 'Native project'].includes(entry.status), 'Unknown version status.');
    return [product, { ...entry, releaseLabel: product + '-v' + entry.version }];
  }));
}

export function packageVersion(product, root) {
  const entry = posVersions()[product];
  assert.ok(entry, 'Unknown POS product: ' + product);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return {
    product,
    appVersion: entry.version,
    releaseLabel: entry.releaseLabel,
    sourceCommit: git(['rev-parse', 'HEAD']),
    sourceDirty: Boolean(git(['status', '--porcelain'])),
    builtAt: new Date().toISOString(),
  };
}

export function inspectPackage(fileOrDirectory) {
  const absolute = path.resolve(fileOrDirectory);
  const file = path.basename(absolute).toLowerCase() === 'release.json' ? absolute : path.join(absolute, 'release.json');
  const release = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(release.version, 1, 'Unsupported release manifest format.');
  const catalog = posVersions();
  const product = release.product ?? (release.id && release.databaseContract ? 'smoothies' : release.sourceCommit ? 'cafe' : null);
  assert.ok(Object.hasOwn(catalog, product), 'Unknown POS release manifest.');
  const appVersion = release.appVersion ?? null;
  if (appVersion !== null) {
    assert.match(appVersion, appVersionPattern);
    assert.equal(release.releaseLabel, product + '-v' + appVersion, 'Version label does not match the package.');
  }
  return {
    product: catalog[product].name,
    version: appVersion ?? 'Legacy package',
    releaseLabel: release.releaseLabel ?? null,
    commit: release.sourceCommit ?? null,
    packageId: release.id ?? null,
    builtAt: release.builtAt ?? null,
    sourceDirty: release.sourceDirty ?? null,
    fixtureOnly: release.fixtureOnly ?? null,
  };
}
