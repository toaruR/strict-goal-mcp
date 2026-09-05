import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, '../..');

test('T001: plugin.json and server package.json structure', () => {
  const pluginJsonPath = path.join(pluginRoot, 'plugin.json');
  assert.ok(fs.existsSync(pluginJsonPath), 'plugin.json must exist');

  const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
  assert.equal(pluginJson['$schema'], 'https://agent-plugins.org/schemas/v1.0.0/plugin.json');
  assert.equal(pluginJson.name, 'rubric-loop');

  // No credentials in keys or values
  const jsonStr = JSON.stringify(pluginJson).toLowerCase();
  for (const cred of ['token', 'secret', 'password', 'key']) {
    // allow schema keyword or harmless words, but check credentials keys
    assert.equal(Object.keys(pluginJson).some(k => ['token', 'secret', 'password'].includes(k.toLowerCase())), false);
  }

  // Only skills and mcpServers in components
  assert.ok(pluginJson.components.skills);
  assert.ok(pluginJson.components.mcpServers);
  assert.equal(pluginJson.components.server, undefined);
  assert.equal(pluginJson.components.presets, undefined);

  const serverPkgPath = path.join(pluginRoot, 'server', 'package.json');
  assert.ok(fs.existsSync(serverPkgPath), 'server/package.json must exist');

  const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
  assert.equal(serverPkg.type, 'module');
});
