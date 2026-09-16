import { loopOpenCreate } from '../tools/loop_open_create.js';
import { loopOpenResume } from '../tools/loop_open_resume.js';
import { loopState } from '../tools/loop_state.js';
import { artifactCommit } from '../tools/artifact_commit.js';
import { scoreSubmit } from '../tools/score_submit.js';
import { rubricAmend } from '../tools/rubric_amend.js';
import { escalate } from '../tools/escalate.js';
import { auditExport } from '../tools/audit_export.js';
import {
  resolveActivePersistence,
  registerSessionDataDir,
  registerChainDataDir,
} from '../store/session_registry.js';

export function handleToolsCall(params, { pluginRoot, pluginRootSource, persistence }) {
  const { name, arguments: input = {} } = params ?? {};

  const activePersistence = resolveActivePersistence({ input, persistence });

  let result;
  try {
    switch (name) {
      case 'loop_open':
        if (input.mode === 'resume') {
          result = loopOpenResume({ input, persistence: activePersistence });
        } else {
          result = loopOpenCreate({ input, pluginRoot, pluginRootSource, persistence: activePersistence });
        }
        break;
      case 'loop_state':
        result = loopState({ input, persistence: activePersistence });
        break;
      case 'artifact_commit':
        result = artifactCommit({ input, persistence: activePersistence });
        break;
      case 'score_submit':
        result = scoreSubmit({ input, persistence: activePersistence });
        break;
      case 'rubric_amend':
        result = rubricAmend({ input, persistence: activePersistence });
        break;
      case 'escalate':
        result = escalate({ input, persistence: activePersistence });
        break;
      case 'audit_export':
        result = auditExport({ input, persistence: activePersistence });
        break;
      default: {
        const err = new Error(`Tool not found: ${name}`);
        err.rpcCode = -32601;
        throw err;
      }
    }

    if (activePersistence?.dir) {
      const sessionId = result?.session_id || input?.session_id;
      if (sessionId) {
        registerSessionDataDir(sessionId, activePersistence.dir);
      }
      const chainId = result?.chain_id || input?.chain_id;
      if (chainId) {
        registerChainDataDir(chainId, activePersistence.dir);
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
  } catch (err) {
    if (err.rpcCode) {
      throw err;
    }
    const errPayload = {
      error: {
        code: err.code || 'E_INTERNAL',
        message: err.message,
        detail: err.detail ?? {},
      },
    };
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(errPayload, null, 2),
        },
      ],
      structuredContent: errPayload,
    };
  }
}
