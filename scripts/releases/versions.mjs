import assert from 'node:assert/strict';
import { inspectPackage, posVersions } from './version-info.mjs';

try {
  const [command, ...paths] = process.argv.slice(2);
  const { familyRelease, version, products } = posVersions();
  if (!command) {
    console.log('POS family release ' + familyRelease);
    console.table(Object.entries(products).map(([product, name]) => ({
      Product: name, Version: version, Label: product + '-v' + version,
    })));
  } else if (command === 'inspect' && paths.length === 1) {
    console.log(JSON.stringify(inspectPackage(paths[0]), null, 2));
  } else if (command === 'verify' && paths.length === Object.keys(products).length) {
    const packages = paths.map(inspectPackage);
    assert.deepEqual(packages.map(entry => entry.product).sort(), Object.values(products).sort(),
      'Pass one package each for Café, Smoothies and Papelería.');
    const commit = packages[0].familyCommit;
    assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Missing POS family commit.');
    for (const entry of packages) {
      assert.equal(entry.familyRelease, familyRelease, entry.product + ' belongs to another family release.');
      assert.equal(entry.familyCommit, commit, entry.product + ' was built from another family commit.');
    }
    console.log('Verified all three packages for ' + familyRelease + ' at ' + commit.slice(0, 7));
  } else {
    throw Error('Use npm run versions, npm run versions -- inspect <manifest>, or npm run versions -- verify <cafe> <smoothies> <papeleria>.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
