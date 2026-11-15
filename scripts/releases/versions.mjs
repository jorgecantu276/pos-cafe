import { inspectPackage, posVersions } from './version-info.mjs';

try {
  const [command, location, ...rest] = process.argv.slice(2);
  if (!command) {
    console.table(Object.values(posVersions()).map(({ name, version, releaseLabel, status }) => ({
      Product: name, Version: version, Label: releaseLabel, Status: status,
    })));
  } else if (command === 'inspect' && location && !rest.length) {
    const result = inspectPackage(location);
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw Error('Use npm run versions, or npm run versions -- inspect <release.json or release folder>.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
