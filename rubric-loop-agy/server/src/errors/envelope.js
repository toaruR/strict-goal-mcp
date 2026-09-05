import { CODES } from './codes.js';

export function toErrorEnvelope(code, message, detail = {}) {
  return { error: { code, message, detail } };
}

export function fromException(err) {
  if (err && err.code && CODES[err.code]) {
    return toErrorEnvelope(err.code, err.message, err.detail ?? {});
  }
  return toErrorEnvelope('E_INTERNAL', 'internal error', {});
}
