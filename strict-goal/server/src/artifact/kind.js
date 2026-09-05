import { ARTIFACT_KIND_BY_MODE } from '../config/defaults.js';

export function defaultArtifactKind(loopMode) {
  return ARTIFACT_KIND_BY_MODE[loopMode];
}

// §19.5 / 既定 artifact_kind 表のとおり、モードごとに許される artifact_kind は
// 既定値ちょうど1つのみ（design→markdown / plan→plan / implement→fileset）。
export function assertArtifactKind(loopMode, artifactKind) {
  const expected = ARTIFACT_KIND_BY_MODE[loopMode];
  if (artifactKind !== expected) {
    const err = new Error(
      `artifact_kind:${artifactKind} does not match loop_mode:${loopMode} (expected ${expected})`,
    );
    err.code = 'E_ARTIFACT_KIND_MISMATCH';
    err.detail = { loop_mode: loopMode, expected, actual: artifactKind };
    throw err;
  }
  return expected;
}
