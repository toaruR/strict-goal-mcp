import { readFileSync, writeFileSync } from 'node:fs';

const pkgUrl = new URL('../strict-goal/server/package.json', import.meta.url);
const pluginUrl = new URL('../strict-goal/plugin.json', import.meta.url);

const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'));
const plugin = JSON.parse(readFileSync(pluginUrl, 'utf8'));

const targetVersion = process.argv[2] || pkg.version;

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(targetVersion)) {
  console.error(`Error: Invalid semver version '${targetVersion}'`);
  process.exit(1);
}

let updated = false;

if (pkg.version !== targetVersion) {
  pkg.version = targetVersion;
  writeFileSync(pkgUrl, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`Updated package.json version to ${targetVersion}`);
  updated = true;
}

if (plugin.version !== targetVersion) {
  plugin.version = targetVersion;
  writeFileSync(pluginUrl, JSON.stringify(plugin, null, 2) + '\n', 'utf8');
  console.log(`Updated plugin.json version to ${targetVersion}`);
  updated = true;
}

if (!updated) {
  console.log(`Both package.json and plugin.json are already at version ${targetVersion}`);
}
