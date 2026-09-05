import { loopOpenCreate } from '../tools/loop_open_create.js';
import { loopOpenResume } from '../tools/loop_open_resume.js';
import { loopState } from '../tools/loop_state.js';
import { artifactCommit } from '../tools/artifact_commit.js';
import { scoreSubmit } from '../tools/score_submit.js';
import { rubricAmend } from '../tools/rubric_amend.js';
import { escalate } from '../tools/escalate.js';
import { auditExport } from '../tools/audit_export.js';

export function handleToolsCall(params, { pluginRoot, pluginRootSource, pluginData }) {
  const { name, arguments: input = {} } = params ?? {};
  const persistence = pluginData;

  let result;
  switch (name) {
    case 'loop_open':
      if (input.mode === 'resume') {
        result = loopOpenResume({ input, persistence });
      } else {
        result = loopOpenCreate({ input, pluginRoot, pluginRootSource, persistence });
      }
      break;
    case 'loop_state':
      result = loopState({ input, persistence });
      break;
    case 'artifact_commit':
      result = artifactCommit({ input, persistence });
      break;
    case 'score_submit':
      result = scoreSubmit({ input, persistence });
      break;
    case 'rubric_amend':
      result = rubricAmend({ input, persistence });
      break;
    case 'escalate':
      result = escalate({ input, persistence });
      break;
    case 'audit_export':
      result = auditExport({ input, persistence });
      break;
    default: {
      const err = new Error(`Tool not found: ${name}`);
      err.rpcCode = -32601;
      throw err;
    }
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
    structuredContent: result,
  };
}
