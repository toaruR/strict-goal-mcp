import { canonicalStringify } from '../hash/digest.js';
import { computeManifestDigest } from '../artifact/fileset.js';

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizedPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || value.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return value;
}

function keyed(items, field, valid) {
  if (!Array.isArray(items)) return null;
  const result = new Map();
  for (const entry of items) {
    if (!object(entry) || typeof entry[field] !== 'string' || !valid(entry)) return null;
    const key = entry[field];
    if (result.has(key)) return null;
    result.set(key, canonicalStringify(entry));
  }
  return result;
}

// Null means unknown: callers must invalidate everything rather than guess.
export function deriveUpstreamChanges(kind, beforeBytes, afterBytes) {
  try {
    const before = JSON.parse(beforeBytes);
    const after = JSON.parse(afterBytes);
    if (!object(before) || !object(after)) return null;
    const field = kind === 'plan' ? 'tasks' : kind === 'fileset' ? 'files' : null;
    if (!field) return null;
    const { [field]: oldItems, ...oldGlobal } = before;
    const { [field]: newItems, ...newGlobal } = after;
    if (kind === 'fileset' && ('manifest_output_sha256' in oldGlobal || 'manifest_output_sha256' in newGlobal)) {
      if (!Array.isArray(oldItems) || !Array.isArray(newItems)
        || oldGlobal.manifest_output_sha256 !== computeManifestDigest(oldItems)
        || newGlobal.manifest_output_sha256 !== computeManifestDigest(newItems)) return null;
      delete oldGlobal.manifest_output_sha256;
      delete newGlobal.manifest_output_sha256;
    }
    if (canonicalStringify(oldGlobal) !== canonicalStringify(newGlobal)) return null;
    const valid = kind === 'plan'
      ? (entry) => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(entry.id)
      : (entry) => normalizedPath(entry.path) === entry.path && /^[0-9a-f]{64}$/.test(entry.sha256 ?? '');
    const oldMap = keyed(oldItems, kind === 'plan' ? 'id' : 'path', valid);
    const newMap = keyed(newItems, kind === 'plan' ? 'id' : 'path', valid);
    if (!oldMap || !newMap) return null;
    const prefix = kind === 'plan' ? 'upstream:' : 'artifact:';
    const known = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
    const changed = known
      .filter((key) => oldMap.get(key) !== newMap.get(key))
      .sort().map((key) => prefix + key);
    return { changed, known };
  } catch {
    return null;
  }
}
