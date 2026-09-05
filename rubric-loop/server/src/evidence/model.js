import { sha256Hex } from '../hash/digest.js';
import { validate } from '../schema/validate.js';

function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// §6.4.4 の evidence oneOf（locator / command / upstream）。共有 validate() は oneOf を
// サポートしないため、kind で個別スキーマを選んで検証する（構造違反はスキーマ通過後の
// ごまかし検出より前に評価する E_VALIDATION）。
const EVIDENCE_SCHEMAS = {
  locator: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'locator', 'excerpt'],
    properties: {
      kind: { type: 'string', enum: ['locator'] },
      locator: { type: 'string', minLength: 1, maxLength: 200 },
      excerpt: { type: 'string', minLength: 20, maxLength: 2000 },
    },
  },
  command: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'command', 'exit_code', 'output_excerpt', 'output_sha256'],
    properties: {
      kind: { type: 'string', enum: ['command'] },
      command: { type: 'string', minLength: 3, maxLength: 1000 },
      exit_code: { type: 'integer', minimum: -256, maximum: 255 },
      output_excerpt: { type: 'string', minLength: 1, maxLength: 8000 },
      output_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      target_digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    },
  },
  upstream: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'upstream_locator', 'excerpt'],
    properties: {
      kind: { type: 'string', enum: ['upstream'] },
      upstream_locator: { type: 'string', minLength: 1, maxLength: 200 },
      excerpt: { type: 'string', minLength: 20, maxLength: 2000 },
    },
  },
};

export function validateEvidenceShape(evidence, path) {
  const schema = EVIDENCE_SCHEMAS[evidence?.kind];
  if (!schema) {
    fail('E_VALIDATION', `unknown evidence kind: ${evidence?.kind}`, { path: `${path}.kind`, reason: 'enum' });
  }
  validate(schema, evidence, path);
}

// F8: evidence_digest = sha256(kind + locator/command + excerpt)。
// kind ごとに「本体を指すフィールド」と「引用フィールド」の組が異なる:
//   locator  -> locator + excerpt
//   command  -> command + output_excerpt
//   upstream -> upstream_locator + excerpt
function bodyField(evidence) {
  if (evidence.kind === 'command') return evidence.command;
  if (evidence.kind === 'locator') return evidence.locator;
  if (evidence.kind === 'upstream') return evidence.upstream_locator;
  const err = new Error(`unknown evidence kind: ${evidence.kind}`);
  err.code = 'E_INTERNAL';
  throw err;
}

function excerptField(evidence) {
  return evidence.kind === 'command' ? evidence.output_excerpt : evidence.excerpt;
}

export function computeEvidenceDigest(evidence) {
  const input = evidence.kind + bodyField(evidence) + excerptField(evidence);
  return `sha256:${sha256Hex(input)}`;
}
