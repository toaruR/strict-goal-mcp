import { escalate } from '../../src/tools/escalate.js';

let sequence = 0;
export function approvalFields(persistence, sessionId, { action, targetCriteria, note }) {
  const pending = escalate({ input: {
    session_id: sessionId, submission_id: `request-approval-helper-${++sequence}`,
    action: 'request_human', approval_channel: 'chat', approval_action: action,
    ...(targetCriteria ? { target_criteria: targetCriteria } : {}),
    note: note ?? 'テストユーザーの明示的な判断を受け取るため、このセッションの操作についてチャットで承認を求める。',
  }, persistence });
  return { escalation_id: pending.escalation.escalation_id, human_reply: `${action}を承認します` };
}
