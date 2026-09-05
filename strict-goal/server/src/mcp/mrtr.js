// §18.3。MRTR(Multi Round-Trip Requests) 対応クライアントでは escalate(request_human) を
// 往復1回の input_required/inputResponses で完結させ、非対応クライアントは従来の
// token ファイル方式（escalation/token.js）へ自動的に縮退する。サーバ発の要求は使わない。

export function clientSupportsMrtr(meta) {
  return Boolean(meta?.clientCapabilities?.elicitation);
}

const RESOLUTION_SCHEMA = {
  type: 'object',
  properties: {
    resolution: { type: 'string', enum: ['continue', 'accept_as_is', 'relax_rubric', 'abort'] },
    note: { type: 'string' },
  },
  required: ['resolution'],
};

export function buildElicitationRequest(escalationId, summaryForHuman) {
  return {
    resultType: 'input_required',
    inputRequests: [
      {
        type: 'elicitation',
        message: 'ループが停滞または閾値未達のため人間の判断が必要です。resolution を選んでください。',
        schema: RESOLUTION_SCHEMA,
      },
    ],
    requestState: { escalation_id: escalationId },
    ...(summaryForHuman ? { summary_for_human: summaryForHuman } : {}),
  };
}

// クライアントが inputResponses を付けて再試行した「同じ要求」から回答を取り出す。
// requestState.escalation_id が無い、または回答が無ければ MRTR 往復の2回目ではないと判断する。
export function extractInputResponse(meta) {
  const response = meta?.inputResponses?.[0];
  const escalationId = meta?.requestState?.escalation_id;
  if (!response || !escalationId) return null;
  return { escalationId, resolution: response.resolution, note: response.note };
}
