function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// F5 / 手順8: artifact_digest が前回の判定時から変わっていないのに、
// previous_score が存在する基準のどれか1つでもスコアが上がっていたら拒否する。
export function checkScoreInflation(perCriterion, artifactUnchanged) {
  if (!artifactUnchanged) return;
  const raised = perCriterion.filter((c) => c.previous_score !== null && c.score > c.previous_score);
  if (raised.length > 0) {
    fail('E_SCORE_INFLATION', 'scores increased while artifact digest is unchanged', {
      criteria: raised.map((c) => ({
        criterion_id: c.criterion_id,
        previous_score: c.previous_score,
        score: c.score,
      })),
    });
  }
}

// F9 / 手順9: 上げ幅が max_score_jump を超え、かつ exit_code:0 の command 根拠が2件未満なら拒否する。
export function checkScoreJump(criterionId, currentScore, previousScore, evidence, maxScoreJump) {
  if (previousScore === null) return;
  const delta = currentScore - previousScore;
  if (delta <= maxScoreJump) return;

  const successfulCommandCount = evidence.filter((e) => e.kind === 'command' && e.exit_code === 0).length;
  if (successfulCommandCount < 2) {
    fail('E_SCORE_JUMP', 'score increased more than max_score_jump without two passing command evidence entries', {
      criterion_id: criterionId,
      delta,
    });
  }
}

// F8 / 手順7: スコアが上がった基準で、evidence_digest 集合が前周と完全一致なら拒否する
// （前周と同一の引用を貼り直しただけで点だけ上げる手口を塞ぐ）。
export function checkEvidenceStale(criterionId, currentScore, previousScore, evidenceDigests, previousEvidenceDigests) {
  if (previousScore === null) return;
  if (currentScore <= previousScore) return;

  const now = new Set(evidenceDigests);
  const prev = new Set(previousEvidenceDigests ?? []);
  if (now.size === prev.size && [...now].every((digest) => prev.has(digest))) {
    fail('E_EVIDENCE_STALE', 'evidence_digest set is identical to the previous round for a raised score', {
      criterion_id: criterionId,
      evidence_digests: [...now],
    });
  }
}

// A score below the pass threshold is a claim that a concrete blocking problem
// remains.  Do not accept a generic command result or vague weakness as a
// substitute for the anchor, evidence, and resolution bindings needed to make
// that claim auditable.
export function checkBelowPassBindings(criterionId, score, passScore, evidence, weakness) {
  if (score >= passScore) return;

  const anchors = evidence.filter((item) => item.kind === 'locator'
    && typeof item.locator === 'string' && item.locator.trim().length > 0
    && typeof item.excerpt === 'string' && item.excerpt.trim().length > 0);
  if (anchors.length === 0) {
    fail('E_ISSUE_BINDING_REQUIRED', 'score below pass threshold requires a locator anchor binding', {
      criterion_id: criterionId,
      required: 'anchor',
    });
  }

  if (!Array.isArray(evidence) || evidence.length === 0) {
    fail('E_ISSUE_BINDING_REQUIRED', 'score below pass threshold requires evidence binding', {
      criterion_id: criterionId,
      required: 'evidence',
    });
  }

  if (typeof weakness !== 'string' || weakness.trim().length === 0 || weakness.trim().toLowerCase() === 'none') {
    fail('E_ISSUE_BINDING_REQUIRED', 'score below pass threshold requires a resolution binding', {
      criterion_id: criterionId,
      required: 'resolution',
    });
  }
}
