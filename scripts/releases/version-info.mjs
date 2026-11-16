import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const familyRoot = path.resolve(import.meta.dirname, '../..');
const catalogPath = path.join(familyRoot, 'config/pos-versions.json');
const appVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/;

export function posVersions() {
  const { version, products } = JSON.parse(readFileSync(catalogPath, 'utf8'));
  assert.match(version, appVersionPattern, 'Use X.Y.Z or X.Y.Z-rc.N for the POS family version.');
  assert.deepEqual(Object.keys(products).sort(), ['cafe', 'papeleria', 'smoothies']);
  for (const name of Object.values(products)) {
    assert.ok(typeof name === 'string' && name.trim().length > 0, 'Missing POS product name.');
  }
  return { version, familyRelease: 'pos-v' + version, products };
}

function sourceState(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  return {
    commit: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain'])),
  };
}

export function packageVersion(product, root) {
  const catalog = posVersions();
  assert.ok(Object.hasOwn(catalog.products, product), 'Unknown POS product: ' + product);
  const family = sourceState(familyRoot);
  const source = path.resolve(root) === familyRoot ? family : sourceState(root);
  return {
    product,
    appVersion: catalog.version,
    releaseLabel: product + '-v' + catalog.version,
    familyRelease: catalog.familyRelease,
    familySourceCommit: family.commit,
    familySourceDirty: family.dirty,
    sourceCommit: source.commit,
    sourceDirty: source.dirty,
    builtAt: new Date().toISOString(),
  };
}

export function inspectPackage(fileOrDirectory) {
  const absolute = path.resolve(fileOrDirectory);
  const file = path.basename(absolute).toLowerCase() === 'release.json' ? absolute : path.join(absolute, 'release.json');
  const release = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(release.version, 1, 'Unsupported release manifest format.');
  const { products } = posVersions();
  const product = release.product ?? (release.id && release.databaseContract ? 'smoothies' : release.sourceCommit ? 'cafe' : null);
  assert.ok(Object.hasOwn(products, product), 'Unknown POS release manifest.');
  const appVersion = release.appVersion ?? null;
  if (appVersion !== null) {
    assert.match(appVersion, appVersionPattern);
    assert.equal(release.releaseLabel, product + '-v' + appVersion, 'Version label does not match the package.');
  }
  if (release.familyRelease != null) {
    assert.equal(release.familyRelease, 'pos-v' + appVersion, 'Family release does not match the package.');
  }
  return {
    product: products[product],
    version: appVersion ?? 'Legacy package',
    familyRelease: release.familyRelease ?? null,
    releaseLabel: release.releaseLabel ?? null,
    commit: release.sourceCommit ?? null,
    familyCommit: release.familySourceCommit ?? null,
    packageId: release.id ?? null,
    builtAt: release.builtAt ?? null,
    sourceDirty: release.sourceDirty ?? null,
    familySourceDirty: release.familySourceDirty ?? null,
    fixtureOnly: release.fixtureOnly ?? null,
  };
}
