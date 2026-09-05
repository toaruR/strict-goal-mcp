import path from 'node:path';
import fs from 'node:fs';

export function resolvePluginRoot(env = process.env, argv1 = process.argv[1]) {
  const warnings = [];
  let root = null;
  let source = null;

  const rubricRoot = env.RUBRIC_LOOP_ROOT;
  const claudeRoot = env.CLAUDE_PLUGIN_ROOT;
  const genericRoot = env.PLUGIN_ROOT;

  if (rubricRoot && claudeRoot && rubricRoot !== claudeRoot) {
    warnings.push(`root_conflict: RUBRIC_LOOP_ROOT=${rubricRoot} CLAUDE_PLUGIN_ROOT=${claudeRoot} using=${rubricRoot}`);
  }

  if (rubricRoot) {
    root = path.resolve(rubricRoot);
    source = 'PLUGIN_ROOT';
  } else if (claudeRoot) {
    root = path.resolve(claudeRoot);
    source = 'PLUGIN_ROOT';
  } else if (genericRoot) {
    root = path.resolve(genericRoot);
    source = 'PLUGIN_ROOT';
  } else if (argv1) {
    // server/src/... or server/main.js -> plugin root is parent of server/
    let current = path.resolve(argv1);
    while (current && path.basename(current) !== 'server') {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (path.basename(current) === 'server') {
      root = path.dirname(current);
      source = 'argv0';
    }
  }

  if (!root || !fs.existsSync(root)) {
    if (root && !fs.existsSync(root)) {
      warnings.push(`root_not_found: ${root}`);
    }
    if (!root) {
      warnings.push('root_unresolved');
    }
  }

  return { root, source, warnings };
}
