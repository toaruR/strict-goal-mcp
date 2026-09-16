#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(dir, '../package.json'), 'utf8'));
const plugin = JSON.parse(readFileSync(path.join(dir, '../.agents-plugin/plugin.json'), 'utf8'));

if (!pkg.name || !plugin.name) {
  console.error('Manifest validation failed');
  process.exit(1);
}

console.log('Manifest validation passed for', pkg.name, plugin.name);
