import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RUNTIME_PREFLIGHT_ERROR = 'E_RUNTIME_PREFLIGHT';

export class RuntimePreflightError extends Error {
  constructor(reason, message, details = {}) {
    super(message);
    this.name = 'RuntimePreflightError';
    this.code = RUNTIME_PREFLIGHT_ERROR;
    this.reason = reason;
    this.details = details;
  }
}

function fail(reason, message, details) {
  throw new RuntimePreflightError(reason, message, details);
}

function realFilePath(candidate, label) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    fail('E_RUNTIME_PATH_REQUIRED', `${label} is required`);
  }

  const resolved = path.resolve(candidate);
  try {
    const real = fs.realpathSync(resolved);
    if (!fs.statSync(real).isFile()) {
      fail('E_RUNTIME_SOURCE_NOT_FILE', `${label} must resolve to a file`, { path: real });
    }
    return real;
  } catch (error) {
    if (error instanceof RuntimePreflightError) throw error;
    fail('E_RUNTIME_SOURCE_MISSING', `${label} does not exist`, { path: resolved });
  }
}

function realDirectoryPath(candidate, label) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    fail('E_RUNTIME_PATH_REQUIRED', `${label} is required`);
  }

  const resolved = path.resolve(candidate);
  try {
    const real = fs.realpathSync(resolved);
    if (!fs.statSync(real).isDirectory()) {
      fail('E_RUNTIME_REPOSITORY_NOT_DIRECTORY', `${label} must resolve to a directory`, { path: real });
    }
    return real;
  } catch (error) {
    if (error instanceof RuntimePreflightError) throw error;
    fail('E_RUNTIME_REPOSITORY_MISSING', `${label} does not exist`, { path: resolved });
  }
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Resolve both sides through the filesystem so a symlink cannot make an
// out-of-repository runtime appear to be an approved source.
export function preflightRuntimeIdentity({ repositoryRoot, sourcePath, expectedSourcePath }) {
  const repository = realDirectoryPath(repositoryRoot, 'repositoryRoot');
  const source = realFilePath(sourcePath, 'sourcePath');
  const expected = realFilePath(expectedSourcePath, 'expectedSourcePath');

  if (!isWithin(repository, source) || !isWithin(repository, expected)) {
    fail('E_RUNTIME_OUTSIDE_REPOSITORY', 'runtime source must resolve inside repositoryRoot', {
      repository_root: repository,
      source_path: source,
      expected_source_path: expected,
    });
  }

  if (source !== expected) {
    fail('E_RUNTIME_SOURCE_MISMATCH', 'runtime source does not match the repository source', {
      source_path: source,
      expected_source_path: expected,
    });
  }

  return Object.freeze({
    source_path: source,
    source_digest: `sha256:${crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex')}`,
  });
}
