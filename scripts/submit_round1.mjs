import { scoreSubmit } from '../strict-goal/server/src/tools/score_submit.js';
import { readSession } from '../strict-goal/server/src/store/session_store.js';

const sessionId = 'rl_01M2CA46TVTZ9NX5PCWXDJVH3M';
const persistence = { dir: '.strict-goal' };
const session = readSession('.strict-goal', sessionId);

const payload = {
  session_id: sessionId,
  submission_id: 'sub_anti_r1_score_001',
  expected_round: 1,
  artifact_digest: session.current_artifact.digest,
  scores: [
    {
      criterion_id: 'failure_mode_mapping',
      score: 8,
      rationale: 'F-01〜F-06の主要失敗モードを列挙し対応機構を定義しているが、サーバプロセスのクラッシュ時リカバリやディスク満杯時の縮退動作などの境界的失敗モードの対応が未網羅である。',
      weakness: 'プロセス障害やストレージ枯渇時のリカバリ失敗モードが対応表に含まれていない。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec2-f01',
          excerpt: '| F-01 | Round 1 での全項目9点自己申告による即時 FINAL | 単一モデルの自己肯定感とサーバ側の Round 1 許容 | `policy.min_rounds` (>=2) の導入と Round 1 FINAL 禁止 | サーバで `ITERATING` 強制 |'
        }
      ]
    },
    {
      criterion_id: 'interface_completeness',
      score: 6,
      rationale: '新設エラーコード名とポリシー拡張スキーマは記載されているが、各エラー発生時のdetailペイロード構造およびscore_submitレスポンスの拡張スキーマが具体化されていない。',
      weakness: '新規エラーコード（E_MIN_ROUNDS_NOT_REACHED等）のdetailプロパティのJSON Schemaが未定義である。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec3-err',
          excerpt: '- `E_MIN_ROUNDS_NOT_REACHED`: `round < policy.min_rounds` であり、スコア条件を満たしていても FINAL への遷移を拒絶。'
        },
        {
          kind: 'command',
          command: 'Select-String -Path docs/plans/design-anti-round1-final.md -Pattern "E_MIN_ROUNDS_NOT_REACHED"',
          exit_code: 0,
          output_excerpt: 'docs\\plans\\design-anti-round1-final.md:32:- `E_MIN_ROUNDS_NOT_REACHED`: `round < policy.min_rounds` であり、スコア条件を満たしていても FINAL への遷移を拒絶。',
          output_sha256: '8d53727e9e3d200cc06fd886017f2e6ef76b5ade1965736454e02caf6a753b0c'
        }
      ]
    },
    {
      criterion_id: 'state_externalized',
      score: 8,
      rationale: 'min_rounds等の状態変数をsession.jsonに記録し、loop_state経由で復元可能とする設計方針は示されているが、永続化ファイルの差分構造定義が抽象的である。',
      weakness: 'session.json内のcountersおよびpolicyオブジェクトへの永続化マッピング詳細が未定義。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec5-ext',
          excerpt: '- `session.json` に `min_rounds` および `first_round_evaluation` を記録。'
        }
      ]
    },
    {
      criterion_id: 'verdict_ownership',
      score: 8,
      rationale: '合否判定をサーバのdecideVerdictのみが決定する原則は明記されているが、min_rounds未達時にITERATINGを返す判定式のコード実装レベルの変更点が未記載である。',
      weakness: 'decideVerdict関数内での判定式の具体的なif文条件と優先順位のコード記述が欠落している。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec6-owner',
          excerpt: '- 合否（`verdict`）は strict-goal サーバの `decideVerdict` のみが計算・発行する。'
        }
      ]
    },
    {
      criterion_id: 'anti_gaming',
      score: 7,
      rationale: 'スコア天井や逃避Weaknessのブロック方針を提示しているが、逃避的Weaknessを判定するための正規表現パターン一覧や拒否ルールの厳密な定義が不足している。',
      weakness: 'E_WEAKNESS_EVASIVEで検知対象とするキーワード・正規表現のブラックリストが未定義である。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec7-gaming',
          excerpt: '- Round 1 におけるスコア天井 (`first_round_ceiling`) により、初回から満点を連ねる手口を封殺。'
        }
      ]
    },
    {
      criterion_id: 'state_machine',
      score: 7,
      rationale: '遷移規則の文章記述はあるものの、状態（DRAFTING, SCORING, ITERATING, FINAL等）と全MCPツール呼び出し可否を網羅した状態遷移マトリクス表が作成されていない。',
      weakness: '状態×ツールの全マトリクス表が欠落しており、境界遷移が可視化されていない。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec4-fsm',
          excerpt: '- たとえ全スコア >= 9点であっても、`verdict` は `ITERATING` となり、`must_fix` が強制選定される。'
        }
      ]
    },
    {
      criterion_id: 'convergence',
      score: 8,
      rationale: 'min_roundsとmax_roundsによる下限・上限の規定はあるが、stall_windowおよび連続停滞時のESCALATED遷移との相互作用ルールが詳細化されていない。',
      weakness: 'min_rounds期間中にスコア停滞が発生した場合のstall_windowカウント方針が未定義。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec8-conv',
          excerpt: '- `min_rounds`（既定値: 2）により、最低 1 回の改訂・推敲プロセスを保証。'
        }
      ]
    },
    {
      criterion_id: 'packaging_conformance',
      score: 8,
      rationale: 'strict-goal/serverのスキーマ拡張方針は示されているが、tools_schema.jsおよび既存クライアントとの後方互換性検証方針の記載が不足している。',
      weakness: 'tools_schema.js変更時のMCPクライアント側のdiscovery/キャッシュ影響分析が欠落。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec11-pack',
          excerpt: '- `strict-goal/server` のスキーマ更新、MCP ツール定義互換性の維持。'
        }
      ]
    },
    {
      criterion_id: 'host_portability',
      score: 6,
      rationale: 'Claude CodeとAntigravityの差異吸収を掲げているが、Antigravity環境特有のCLI実行権限、パス区切り文字（Windows pwsh）、実行環境差異の具体策が未記載である。',
      weakness: 'Windows/pwsh環境下でのhelper.js実行時のパス規約およびエスケープ仕様が未定義である。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec12-host',
          excerpt: '- Claude Code（Subagent `Agent()` サポート）と Antigravity（単一エージェント / CLI 実行）の差異を吸収。'
        }
      ]
    },
    {
      criterion_id: 'responsibility_split',
      score: 8,
      rationale: 'サーバ、スキル、エージェント、CLIの4者での責務分割表は存在するが、CI自動テスト実行時における各コンポーネントの挙動の差異が未規定である。',
      weakness: 'CIパイプライン実行時における検証CLIとサーバの結合検証境界が表に記載されていない。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec9-split',
          excerpt: '| `min_rounds` ガード | 判定・強制 | 規約説明 | 結果受信のみ | 関与なし |'
        }
      ]
    },
    {
      criterion_id: 'auditability',
      score: 7,
      rationale: '監査ログへの記録方針はあるが、audit_exportツールの出力スキーマ（session_v1.json / chain_v2.json）への追加プロパティの配置場所が未定義である。',
      weakness: 'audit_exportのJSONスキーマにおけるmin_roundsおよび初回強制指摘フィールドの定義が欠落。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec10-audit',
          excerpt: '- 監査ログに `min_rounds`、Round 1 の必須指摘事項、Round 2 での解消差分が記録される。'
        }
      ]
    },
    {
      criterion_id: 'acceptance_tests',
      score: 6,
      rationale: 'AT-01〜AT-03の受け入れテスト項目は挙げられているが、テストシナリオの入力パラメータ、実行コマンド、期待されるHTTP/JSONレスポンス本文の具体例が欠落している。',
      weakness: '各受け入れテストの具体的な入力JSONと期待されるアサーションコードが未定義である。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec14-at',
          excerpt: '- AT-01: Round 1 で全項目9点を提出した場合、`E_FIRST_ROUND_UNCRITICAL` または `verdict: ITERATING` となること。'
        }
      ]
    },
    {
      criterion_id: 'defaults_decided',
      score: 7,
      rationale: '新設定数の既定値一覧は示されているが、既存のMODE_POLICY_DEFAULTS（design/plan/implement）との統合形式および上書きポリシーが未記載である。',
      weakness: 'MODE_POLICY_DEFAULTS各モード（design, plan, implement）ごとの既定値の個別定義が欠落。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec13-defaults',
          excerpt: '- `MIN_ROUNDS_DEFAULT = 2`'
        }
      ]
    },
    {
      criterion_id: 'self_hosting',
      score: 8,
      rationale: '本設計仕様書自身をstrict-goal designループで検証する方針を明記しているが、Round 1での自己採点指摘事項が次ラウンドでどう反映されるかの追跡手順が浅い。',
      weakness: 'Round 1指摘事項のRound 2への引き継ぎおよび差分検証プロトコルの詳細が未記載。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec15-self',
          excerpt: '- 本設計書自体を `strict-goal design` ループで検証。Round 1 では不備・未網羅を自ら特定し減点して Round 2 へ進める。'
        }
      ]
    },
    {
      criterion_id: 'rejected_alternatives',
      score: 8,
      rationale: 'プロンプト注意喚起やサブエージェント擬似化の却下理由は記載されているが、クライアント側フックやプロキシ型インスペクタ等の他の代替アーキテクチャの検討が欠けている。',
      weakness: 'MCPプロキシ層でのインターセプトやクライアントフック方式の検討および却下理由が欠落。',
      evidence: [
        {
          kind: 'locator',
          locator: 'sec16-alt',
          excerpt: '- **代替案1: プロンプトでの注意喚起の強化**: 既に実施済みで失敗したため却下。'
        }
      ]
    }
  ]
};

const res = scoreSubmit({ input: payload, persistence });
console.log(JSON.stringify(res, null, 2));
