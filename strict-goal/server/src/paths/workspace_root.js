import path from 'node:path';

// data_dir が <workspace>/.strict-goal ならその親、それ以外（--data-dir 直指定）は data_dir 自身をワークスペース根とみなす
export function workspaceRootFromDataDir(dataDir) {
  if (!dataDir) return process.cwd();
  const resolved = path.resolve(dataDir);
  return path.basename(resolved) === '.strict-goal' ? path.dirname(resolved) : resolved;
}
