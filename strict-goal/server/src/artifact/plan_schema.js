import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validate } from '../schema/validate.js';

const planSchemaPath = fileURLToPath(new URL('../../schemas/plan.json', import.meta.url));
export const PLAN_SCHEMA = JSON.parse(readFileSync(planSchemaPath, 'utf8'));

// 汎用 validate() の英文 reason/`$.a[0].b` 形式のパスを、
// 設計書 §19.5.2 が定める E_PLAN_SCHEMA の detail 形式
// （JSON Pointer 風 path / スネークケースの reason トークン）に変換する。
function toPointerPath(path) {
  return path.replace(/^\$/, '').replace(/\[(\d+)\]/g, '/$1').replace(/\./g, '/');
}

function toReasonToken(message) {
  if (message.startsWith('missing required key')) return 'required';
  if (message.startsWith('minItems')) return 'min_items';
  if (message.startsWith('maxItems')) return 'max_items';
  if (message.startsWith('uniqueItems')) return 'unique_items';
  if (message.startsWith('must match pattern')) return 'pattern';
  if (message.startsWith('additional property not allowed')) return 'additional_property';
  if (message.startsWith('must be of type')) return 'type';
  if (message.startsWith('minLength')) return 'min_length';
  if (message.startsWith('maxLength')) return 'max_length';
  if (message.startsWith('minimum')) return 'minimum';
  if (message.startsWith('maximum')) return 'maximum';
  if (message.startsWith('must be one of')) return 'enum';
  return 'invalid';
}

export function validatePlanSchema(plan) {
  try {
    validate(PLAN_SCHEMA, plan);
  } catch (err) {
    if (err.code !== 'E_VALIDATION') throw err;
    const planErr = new Error(err.message);
    planErr.code = 'E_PLAN_SCHEMA';
    planErr.detail = { path: toPointerPath(err.detail.path), reason: toReasonToken(err.detail.reason) };
    throw planErr;
  }
  return true;
}

// LLM が ```json ... ``` で成果物を囲んで送信した場合にコードブロックを自動除去する。
export function stripMarkdownCodeFences(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

// content は JSON 文字列として渡ってくる。構文自体が不正な場合も E_PLAN_SCHEMA。
// Markdown のコードフェンス（```json ... ```）は自動アンラップして受理する。
export function parsePlanContent(content) {
  let plan;
  const raw = stripMarkdownCodeFences(content);
  try {
    plan = JSON.parse(raw);
  } catch {
    const err = new Error('content is not valid JSON');
    err.code = 'E_PLAN_SCHEMA';
    err.detail = { path: '/', reason: 'invalid_json' };
    throw err;
  }
  validatePlanSchema(plan);
  return plan;
}
