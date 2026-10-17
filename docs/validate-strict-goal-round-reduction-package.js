#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(directory, 'strict-goal-round-reduction-package.json');
const schemaPath = path.join(directory, 'strict-goal-round-reduction-schema.json');

function fail(message) {
  console.error(`round-reduction design support package invalid: ${message}`);
  process.exitCode = 1;
}

let manifest;
let schema;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (error) {
  fail(error.message);
  process.exit();
}

const expectedFiles = [
  'design-strict-goal-round-reduction.md',
  'strict-goal-round-reduction-schema.json',
  'validate-strict-goal-round-reduction-package.js',
];
const expectedEntrypoints = ['score_submit', 'loop_state'];
const fallback = 'resolve paths relative to this manifest; use the Node executable on PATH';

if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail('schema $schema');
if (schema.$id !== 'strict-goal-round-reduction-schema.json') fail('schema $id');
if (schema.type !== 'object' || schema.additionalProperties !== false) fail('schema object contract');
if (JSON.stringify(schema.required) !== JSON.stringify(['package', 'version', 'schema_version', 'files', 'entrypoints', 'portability'])) fail('schema required fields');
if (schema.properties?.package?.const !== 'strict-goal-round-reduction-design-support') fail('schema package');
if (schema.properties?.schema_version?.const !== 'round-reduction-v2') fail('schema version');
if (schema.properties?.portability?.properties?.allowed_environment_variables?.maxItems !== 0) fail('schema allowed_environment_variables');
if (schema.properties?.portability?.properties?.fallback?.const !== fallback) fail('schema fallback');

if (manifest.package !== 'strict-goal-round-reduction-design-support') fail('package');
if (!/^2\.\d+\.\d+-draft\.\d+$/.test(manifest.version)) fail('version');
if (manifest.schema_version !== 'round-reduction-v2') fail('schema_version');
if (JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles)) fail('files');
for (const file of manifest.files ?? []) {
  if (!/^[A-Za-z0-9._-]+$/.test(file) || !fs.existsSync(path.join(directory, file))) fail(`file ${file}`);
}
if (JSON.stringify(manifest.entrypoints) !== JSON.stringify(expectedEntrypoints)) fail('entrypoints');
if (!Array.isArray(manifest.portability?.allowed_environment_variables) || manifest.portability.allowed_environment_variables.length !== 0) fail('allowed_environment_variables');
if (manifest.portability?.fallback !== fallback) fail('fallback');

if (!process.exitCode) console.log('round-reduction design support package valid: 3 files, 2 entrypoints, schema=round-reduction-v2');
