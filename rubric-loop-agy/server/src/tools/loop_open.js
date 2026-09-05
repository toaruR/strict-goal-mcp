import { loopOpenCreate } from './loop_open_create.js';
import { loopOpenResume } from './loop_open_resume.js';

export function loopOpen({ input, pluginRoot, pluginRootSource, persistence }) {
  if (input?.mode === 'resume') {
    return loopOpenResume({ input, persistence });
  }
  return loopOpenCreate({ input, pluginRoot, pluginRootSource, persistence });
}
