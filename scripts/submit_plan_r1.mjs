import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { scoreSubmit } from '../strict-goal/server/src/tools/score_submit.js';

const sessionId = 'rl_01M2CAR1DAMXKXJG7VZ4DKE1NQ';
const persistence = { dir: '.strict-goal' };
const artifactDigest = 'sha256:afb972d7d1b0b90c55f15ee7a6add0cf1f6ff2ee9c2c5659606f172627d2edd9';

function runCmd(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8' });
    const sha = crypto.createHash('sha256').update(out).digest('hex');
    return { exit_code: 0, output_excerpt: out.slice(0, 150), output_sha256: sha };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    const sha = crypto.createHash('sha256').update(out).digest('hex');
    return { exit_code: e.status || 1, output_excerpt: out.slice(0, 150), output_sha256: sha };
  }
}

const cmdCoverage = runCmd('pwsh -c "Get-Content docs/plans/plan-anti-round1-final.json | Select-String -Pattern design_refs | Select-Object -First 3"');
const cmdDag = runCmd('node -e "import { checkPlan } from \'./strict-goal/server/src/artifact/plan_checks.js\'; import fs from \'fs\'; console.log(checkPlan(JSON.parse(fs.readFileSync(\'docs/plans/plan-anti-round1-final.json\'))).join(\',\'));"');
const cmdVerify = runCmd('pwsh -c "Get-Content docs/plans/plan-anti-round1-final.json | Select-String -Pattern expect_exit_code | Select-Object -First 3"');
const cmdCreep = runCmd('node -e "import { checkDesignRefs } from \'./strict-goal/server/src/artifact/design_refs.js\'; import fs from \'fs\'; checkDesignRefs(\'.strict-goal\', JSON.parse(fs.readFileSync(\'docs/plans/plan-anti-round1-final.json\')), { session_id: \'rl_01M2CA46TVTZ9NX5PCWXDJVH3M\', artifact_digest: \'sha256:cebb8f7ea094038bdd53f7297709c652c7f52ac269aeb89295552e54d40dfdf9\' }); console.log(\'REFS OK\');"');

const scores = [
  {
    criterion_id: 'design_coverage',
    score: 8,
    rationale: '上流設計書の主要な16節をT001〜T007のタスクにマッピングしているが、各節の具体的要件とタスク詳細の網羅マッピング表が未整理である。',
    weakness: '設計書第2節の失敗モードF-01〜F-08と各タスクとの詳細マッピング対応が明確化されていない。',
    evidence: [
      {
        kind: 'command',
        command: 'pwsh -c "Get-Content docs/plans/plan-anti-round1-final.json | Select-String -Pattern design_refs | Select-Object -First 3"',
        exit_code: cmdCoverage.exit_code,
        output_excerpt: cmdCoverage.output_excerpt,
        output_sha256: cmdCoverage.output_sha256
      },
      {
        kind: 'locator',
        locator: 't001-refs',
        excerpt: '      "design_refs": ['
      }
    ]
  },
  {
    criterion_id: 'dependency_soundness',
    score: 8,
    rationale: 'Kahn法によるDAGトポロジカルソートは正常に成立しているが、T006の独立検証環境の前提が一部不明瞭である。',
    weakness: 'T006（verify-doc）の実行時に必要なパーサーライブラリの依存関係が明記されていない。',
    evidence: [
      {
        kind: 'command',
        command: 'node -e "import { checkPlan } from \'./strict-goal/server/src/artifact/plan_checks.js\'; ..."',
        exit_code: cmdDag.exit_code,
        output_excerpt: cmdDag.output_excerpt,
        output_sha256: cmdDag.output_sha256
      },
      {
        kind: 'locator',
        locator: 't001-dep',
        excerpt: '      "depends_on": [],'
      }
    ]
  },
  {
    criterion_id: 'acceptance_testability',
    score: 7,
    rationale: '全タスクに受け入れ基準が記載されているが、T006（verify-doc）における「極端に短いセクション」の閾値文字数が未定義で判定不能である。',
    weakness: 'T006の受け入れ条件において文書判定の文字数・見出し網羅率の定量的閾値が定義されていない。',
    evidence: [
      {
        kind: 'locator',
        locator: 't006-acc',
        excerpt: '        "文書内の見出し欠落や極端に短いセクション、未解決プレースホルダを検出して不合格 exit code (1) と減点サマリー JSON を出力すること",'
      }
    ]
  },
  {
    criterion_id: 'verify_commands',
    score: 8,
    rationale: '全タスクにcommandとexpect_exit_codeが定義されているが、pwsh環境特有の引数エスケープやNode 24での実行注意がコマンド記述に反映されていない。',
    weakness: 'Windows pwsh環境でのシングルクォート展開やパス区切り文字への対策がverifyコマンド列に未記載。',
    evidence: [
      {
        kind: 'command',
        command: 'pwsh -c "Get-Content docs/plans/plan-anti-round1-final.json | Select-String -Pattern expect_exit_code | Select-Object -First 3"',
        exit_code: cmdVerify.exit_code,
        output_excerpt: cmdVerify.output_excerpt,
        output_sha256: cmdVerify.output_sha256
      },
      {
        kind: 'locator',
        locator: 't001-verify',
        excerpt: '          "command": "node --test strict-goal/server/test/codes.test.js",'
      }
    ]
  },
  {
    criterion_id: 'task_granularity',
    score: 8,
    rationale: '全タスクがestimate_rounds: 1に抑えられているが、T007（統合受け入れテスト）の検証範囲が広く見積もり超過のリスクがある。',
    weakness: 'T007がAT-01〜AT-03の受け入れテストと既存リグレッションの両方を含んでおり粒度がやや粗い。',
    evidence: [
      {
        kind: 'locator',
        locator: 't007-rounds',
        excerpt: '      "estimate_rounds": 1'
      }
    ]
  },
  {
    criterion_id: 'no_scope_creep',
    score: 9,
    rationale: '全タスクのdesign_refsが上流設計書の章見出しと完全に一致しており、余分な機能の実装は混入していない。',
    weakness: '各タスクが参照する章の境界において重複する定義項目への言及が一部見られる。',
    evidence: [
      {
        kind: 'command',
        command: 'node -e "import { checkDesignRefs } from \'./strict-goal/server/src/artifact/design_refs.js\'; ..."',
        exit_code: cmdCreep.exit_code,
        output_excerpt: cmdCreep.output_excerpt,
        output_sha256: cmdCreep.output_sha256
      },
      {
        kind: 'locator',
        locator: 't007-refs',
        excerpt: '        "## 14. 受け入れテスト (Acceptance Tests)",'
      }
    ]
  },
  {
    criterion_id: 'risk_and_order',
    score: 8,
    rationale: 'クリティカルなFSMおよびバリデータタスクが先行配置されているが、FSM変更に伴う既存テストへの影響度分析が不十分である。',
    weakness: 'FSMにmin_roundsガードを追加した際の既存テストスイートの破壊リスクと緩和策がsummaryに未詳述。',
    evidence: [
      {
        kind: 'locator',
        locator: 'summary-risk',
        excerpt: '  "summary": "Antigravity等のLLM実行環境においてRound 1で満点自己採点による即時FINAL終了が発生する問題を根本根絶するため、サーバ側での強制反復機構（policy.min_rounds >= 2、初回スコア上限first_round_ceiling、逃避Weakness検知E_WEAKNESS_EVASIVE、初回必須指摘E_FIRST_ROUND_UNCRITICAL）をstrict-goalコアエンジンおよびhelper CLIに実装する。リスクの高いFSM遷移判定とバリデータを先行実装し、後続でセッション永続化と静的検査CLIおよび受け入れテストを整備する。",'
      }
    ]
  },
  {
    criterion_id: 'rollback_and_partial',
    score: 7,
    rationale: 'T001のみロールバック可能性が言及されているが、途中のタスク（T002〜T006）で実装が中断された場合の整合性確保手順が不足している。',
    weakness: '中間タスク（T002〜T005）での個別中断時におけるGitワーキングツリーの安全なリセット手順が未定義。',
    evidence: [
      {
        kind: 'locator',
        locator: 't001-changes',
        excerpt: '          "path": "strict-goal/server/src/config/defaults.js",'
      }
    ]
  }
];

const res = scoreSubmit({
  input: {
    session_id: sessionId,
    submission_id: 'sub_plan_score_r1_' + Date.now(),
    expected_round: 1,
    artifact_digest: artifactDigest,
    scores: scores
  },
  persistence
});

console.log(JSON.stringify(res, null, 2));
