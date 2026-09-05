import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolvePluginRoot(env, argv1) {
  const warnings = [];
  const rubricLoopRoot = env.RUBRIC_LOOP_ROOT;
  const claudePluginRoot = env.CLAUDE_PLUGIN_ROOT;

  if (rubricLoopRoot && claudePluginRoot && rubricLoopRoot !== claudePluginRoot) {
    warnings.push(
      `root_conflict: RUBRIC_LOOP_ROOT=${rubricLoopRoot} CLAUDE_PLUGIN_ROOT=${claudePluginRoot} using=${rubricLoopRoot}`
    );
    return { root: rubricLoopRoot, source: 'PLUGIN_ROOT', warnings };
  }

  if (rubricLoopRoot) {
    return { root: rubricLoopRoot, source: 'PLUGIN_ROOT', warnings };
  }

  if (claudePluginRoot) {
    return { root: claudePluginRoot, source: 'PLUGIN_ROOT', warnings };
  }

  if (env.PLUGIN_ROOT) {
    return { root: env.PLUGIN_ROOT, source: 'PLUGIN_ROOT', warnings };
  }

  if (argv1) {
    const mainPath = argv1.startsWith('file://') ? fileURLToPath(argv1) : argv1;
    const derivedRoot = path.dirname(path.dirname(mainPath));
    warnings.push('root_derived_from_argv0');
    return { root: derivedRoot, source: 'argv0', warnings };
  }

  warnings.push('root_unresolved');
  return { root: null, source: 'unresolved', warnings };
}
