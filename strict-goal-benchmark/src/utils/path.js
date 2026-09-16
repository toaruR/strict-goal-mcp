import path from 'node:path';

/**
 * Normalizes a file path to POSIX format, correctly preserving Windows UNC
 * and long path prefixes (\\?\ and \\?\UNC\).
 *
 * @param {string} targetPath - Path to normalize
 * @returns {string} Normalized POSIX-style path
 */
export function normalizeHostPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return '';

  let prefix = '';
  let rest = targetPath;

  if (rest.startsWith('\\\\?\\UNC\\')) {
    prefix = '//?/UNC/';
    rest = rest.slice(8);
  } else if (rest.startsWith('//?/UNC/')) {
    prefix = '//?/UNC/';
    rest = rest.slice(8);
  } else if (rest.startsWith('\\\\?\\')) {
    prefix = '//?/';
    rest = rest.slice(4);
  } else if (rest.startsWith('//?/')) {
    prefix = '//?/';
    rest = rest.slice(4);
  } else if (rest.startsWith('\\\\') || rest.startsWith('//')) {
    prefix = '//';
    rest = rest.slice(2);
  }

  const normalizedRest = rest.replace(/\\/g, '/').replace(/\/+/g, '/');
  return prefix + normalizedRest;
}
