const SUPPORTED_KEYWORDS = new Set([
  'type',
  'enum',
  'required',
  'additionalProperties',
  'properties',
  'items',
  'pattern',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'uniqueItems',
]);

function fail(path, reason) {
  const err = new Error(`validation failed at ${path}: ${reason}`);
  err.code = 'E_VALIDATION';
  err.detail = { path, reason };
  throw err;
}

function unsupported(keyword) {
  const err = new Error(`unsupported schema keyword: ${keyword}`);
  err.code = 'E_INTERNAL';
  throw err;
}

function assertSupported(schema) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(key)) unsupported(key);
  }
}

function typeMatches(type, value) {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'null':
      return value === null;
    default:
      unsupported(`type:${type}`);
      return false;
  }
}

export function validate(schema, value, path = '$') {
  assertSupported(schema);

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => typeMatches(type, value))) {
      fail(path, `must be of type ${types.join('|')}`);
    }
  }

  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    fail(path, `must be one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.pattern !== undefined) {
    if (typeof value !== 'string' || !new RegExp(schema.pattern).test(value)) {
      fail(path, `must match pattern ${schema.pattern}`);
    }
  }

  if (schema.minLength !== undefined) {
    if (typeof value !== 'string' || value.length < schema.minLength) {
      fail(path, `minLength ${schema.minLength}`);
    }
  }

  if (schema.maxLength !== undefined) {
    if (typeof value !== 'string' || value.length > schema.maxLength) {
      fail(path, `maxLength ${schema.maxLength}`);
    }
  }

  if (schema.minimum !== undefined) {
    if (typeof value !== 'number' || value < schema.minimum) {
      fail(path, `minimum ${schema.minimum}`);
    }
  }

  if (schema.maximum !== undefined) {
    if (typeof value !== 'number' || value > schema.maximum) {
      fail(path, `maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(path, `minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(path, `maxItems ${schema.maxItems}`);
    }
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) fail(path, 'uniqueItems violated');
        seen.add(key);
      }
    }
    if (schema.items) {
      value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`));
    }
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in value)) fail(`${path}.${key}`, `missing required key: ${key}`);
      }
    }
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) fail(`${path}.${key}`, 'additional property not allowed');
      }
    }
    for (const [key, subSchema] of Object.entries(props)) {
      if (key in value) validate(subSchema, value[key], `${path}.${key}`);
    }
  }

  return true;
}
