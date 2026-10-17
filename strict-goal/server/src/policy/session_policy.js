export const V1_POLICY = Object.freeze({ schema_version: 1, policy_version: 'v1', stage: 'v1' });

const STAGES = new Set(['v1', 'observe-only', 'dual-read', 'enforce-new-session', 'default-on']);
export function pinSessionPolicy(stage = process.env.STRICT_GOAL_ROUND_REDUCTION_STAGE ?? 'v1') {
  if (!STAGES.has(stage)) {
    const error = new Error('unknown round reduction policy stage');
    error.code = 'E_SESSION_POLICY_INVALID';
    throw error;
  }
  return stage === 'v1' ? { ...V1_POLICY } : { schema_version: 2, policy_version: 'v2', stage };
}
export function enforceV2(policy) {
  return policy.schema_version === 2 && (policy.stage === 'enforce-new-session' || policy.stage === 'default-on');
}
