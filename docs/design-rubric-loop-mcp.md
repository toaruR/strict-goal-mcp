# rubric ループ実行 MCP サーバ 設計書

**パッケージ名**: `rubric-loop`
**版**: 1.0.0（設計書 rev.4）
**配布形態**: Agent Plugins 1.0.0 準拠 可搬プラグインパッケージ
**目的**: 「PLAN → DO → VERIFY → DECIDE を全基準9点以上まで回す」ワンショット・プロンプトの挙動を、**モデルの自制心ではなくサーバ側の永続状態と閾値判定**で成立させる。

---

## 目次

| 節 | 内容 |
|---|---|
| §0–1 | 用語 / 前提と置いた仮定 |
| §2 | 潰す失敗モード 20件 と対策の1対1対応 |
| §3–4 | アーキテクチャ / 状態機械（呼べる・呼べないツール） |
| §5 | rubric スキーマと版管理（緩和の監査） |
| §6 | ツール表面（7ツールの入出力 JSON Schema 実物とエラー条件） |
| §7 | 判定アルゴリズム・収束・打ち切り・既定値の根拠 |
| §8 | 状態の外部化（PLUGIN_DATA レイアウト・原子性・再開） |
| §9 | 可搬パッケージ実物（plugin.json / mcp.json）と適合性チェック |
| §10 | スキルとサーバの責務分割・SKILL.md 実物・縮退動作 |
| §11 | ホスト差の吸収（PLUGIN_ROOT / ${CLAUDE_PLUGIN_ROOT} 解決順序） |
| §12 | 監査可能性（audit JSON の完全な実例と再検証手順） |
| §13 | 受け入れテスト 18本 |
| §14 | セルフホスティング検証（本書自身をこのツール列で作るトレース） |
| §15–17 | 却下した代替案 / 既定値まとめ / 未解決を残さないための注記 |
| §18 | MCP 2026-07-28（ステートレス改訂）への適合 |
| §19 | **3モード拡張**（design → plan → implement）: 連鎖・失効・差し戻し・成果物の型・プリセット・実装のごまかし対策 |
| §20 | 改訂履歴（何を足し・何を変え・何を変えなかったか） |

---

## 0. 用語

| 語 | 定義 |
|---|---|
| セッション | 1つの成果物を1つの rubric で収束させる単位。**サーバが発行する**ハンドル `session_id`（ULID、`rl_` 前置）で識別し、以後は通常のツール引数として毎回渡す（MCP 2026-07-28 のステートレス方針、§18）。 |
| ラウンド（周回） | `artifact_commit` → `score_submit` の1往復。1始まりの整数 `round`。 |
| 成果物ダイジェスト | 成果物本文の SHA-256（正規化後）。`artifact_digest`。 |
| 判定 | サーバが返す `ITERATING` / `FINAL` / `STALLED` / `ESCALATED` / `ABORTED`。モデルは判定を自称できない。 |
| 根拠 (evidence) | 各スコアに必須添付する検証物。`locator`（成果物内位置）または `command`（実行コマンドと出力）。 |
| PLUGIN_ROOT / PLUGIN_DATA | Agent Plugins 1.0.0 が定義する2変数。前者は読み取り専用のプラグイン配置先、後者は更新をまたいで永続する書き込み可能ディレクトリ。 |
| モード (`loop_mode`) | セッションが何を収束させるか。`design` / `plan` / `implement` の3値。`loop_open` で固定し以後変更不能（§19.1）。`loop_open.mode`（`create`/`resume`）とは**別概念**。 |
| チェーン | design → plan → implement と連なるセッション群。`chain_id`（ULID、`ch_` 前置）で識別する（§19.2）。 |
| 上流ピン (upstream pin) | 下流セッションが固定する「上流セッションのハンドル + 確定成果物ダイジェスト」の組。下流はこれを知らずには開けない（§19.2.1）。 |
| 失効 (SUPERSEDED) | ピンした上流成果物が変わったために、下流の判定（`FINAL` を含む）が取り消された状態（§19.3）。 |
| 差し戻し (kickback) | 下流で上流の欠陥を見つけたときに上流を再オープンし、自分は凍結される操作（§19.4）。 |

---

## 1. 前提（置いた仮定を含む）

### 1.1 動かせない前提

- 配布は **Agent Plugins 1.0.0** 準拠。コンポーネントは `skills/` と `mcp.json` の **2種のみ**、固定位置でしか発見されない。位置が無いのは「有効な不在」でありエラーではない。
- `plugin.json` は closed schema。必須は `$schema` と `name`。未知の最上位フィールドは**報告のうえ無視**される。
- `plugin.json` と `mcp.json` の Agent Plugins バージョンは**一致必須**（本設計は両者とも `v1.0.0`）。
- transport は **stdio 既定**、`streamable-http` も可。**legacy SSE には一切依存しない**（Codex / Hermes / NanoClaw は未実装のため）。宣言した transport で初回接続し、**フォールバック経路は仕様に無い**。
- `stdio` の `command` は**単一実行トークン**。シェル文字列・パイプ・リダイレクト不可。bare name か `./` 始まりのプラグイン相対パスのみ。**command 内では変数展開されない**。
- 変数展開が効くのは **`args` の値 / `env` の値 / `cwd`** のみ。`env` のキー、URL、HTTP ヘッダには効かない。使ってよい変数は **`PLUGIN_ROOT` と `PLUGIN_DATA` の2つだけ**。
- `cwd` は既定でプラグインルート。指定しても `PLUGIN_ROOT` / `PLUGIN_DATA` 配下から出ない。
- HTTP ヘッダはリテラル。**1.0.0 に可搬な認証機構は無いので、ヘッダにもパッケージ内にも資格情報を置かない**。
- コンポーネント個別の失敗は**非致命**。MCP サーバが落ちても `skills/` のロードは止まらない。
- Claude Code は互換クライアント一覧に無く独自プラグイン形式。`${CLAUDE_PLUGIN_ROOT}` は `PLUGIN_ROOT` の**ベンダー別名**として扱う。
- MCP は **2026-07-28 リビジョン**を第一の対象とする。同リビジョンはプロトコルレベルのセッション（`Mcp-Session-Id`）と `initialize` ハンドシェイクを廃止し、跨り状態は「サーバが発行したハンドルを通常のツール引数で渡す」形を指定している。詳細と対応は §18。

### 1.2 置いた仮定（仕様に無い／曖昧なので、依存しない形にした）

| # | 仮定 | 仕様上の位置づけ | 依存しないための設計 |
|---|---|---|---|
| A1 | ホストは `PLUGIN_DATA` を提供する | 仕様は変数の存在を定義するが、未提供時の挙動は**規定していない** | 未提供なら `EPHEMERAL` モードで起動し、全ツール応答に `persistence:"ephemeral"` を付す。`loop_open` は `allow_ephemeral:true` が無い限り `E_NO_PERSISTENCE` で拒否（§8.2） |
| A2 | `node` が PATH にある | 仕様は実行環境を規定しない | `command` を `node` bare name にするのが既定。PATH に無いホスト向けに `./bin/rubric-loop`（単一実行可能ファイル）の代替 `mcp.json` を §9.3 に併記。どちらもシェル不要 |
| A3 | サーバはワークスペースのファイルを読める | 仕様外（クライアント任せ） | サーバは**ワークスペースを読まない**。成果物本文は `artifact_commit` の引数としてモデルが渡す。ファイル参照は監査用メタデータに留める |
| A4 | サーバは検証コマンドを実行できる | 仕様外・かつ攻撃面 | **サーバはコマンドを実行しない**。`command` 根拠は「コマンド文字列 + exit code + 出力 + 出力ハッシュ」の記録に限る。再実行は監査者が `audit_export` の内容で行う（§12.3 の再検証手順） |
| A5 | ホストは MCP tool の `outputSchema` / `structuredContent` を解釈する | MCP 側の任意機能 | 全ツールは structured content と**同内容の JSON テキスト**を `content[0].text` に二重で返す。解釈しないホストでも情報が落ちない |
| A6 | `plugin.json` の任意フィールド名 | closed schema だが省略可能フィールドの網羅は**未確認** | `$schema` と `name` 以外は「無視されても機能に影響しない情報」だけを置く（§9.1）。未知扱いされても非致命 |
| A7 | 同一 `session_id` に同時アクセスする並行クライアントがありうる | 仕様外 | `PLUGIN_DATA` 上のロックファイル + 楽観ロック（`expected_round`）で衝突を `E_CONCURRENT` として弾く（§8.4） |
| A8 | ホストが話す MCP リビジョンは 2026-07-28 か 2025-11-25 のいずれか | Agent Plugins 1.0.0 は **MCP のリビジョンを規定していない**（クライアント任せ） | `server/discover` で両版を広告し、ツール表面と判定ロジックを**リビジョン非依存**にする。MRTR など新版限定機能は必ず旧版向けの代替経路を持たせる（§18.3） |
| A9 | モデルは成果物ファイルの SHA-256 を自分で計算できる（`sha256sum` 等が使える） | 仕様外 | サーバは**ハッシュの真正性を検証しない**。`fileset` のマニフェストは申告であり、サーバが担保するのは内部整合性と再現手順の記録に限る。真正性が要る場面では監査者が `manifest_command` を再実行する（§19.5.3 / §19.8.4） |
| A10 | 1つのチェーンは1人の人間の管理下にある | 仕様外（認証機構が無いため） | `human_token` は**速度制限であってセキュリティ境界ではない**という既存の立場を、差し戻し・再オープンにもそのまま適用する。多人数運用は §1.3 のスコープ外 |

### 1.3 スコープ外

- rubric の**内容**の良し悪しの判断（サーバは構造とバージョン管理のみを担保）。
- 成果物のレンダリング・配布・CI 連携（§13 で棄却理由を述べる）。
- 認証・マルチテナント（1.0.0 に可搬な認証機構が無いため、ローカル単一ユーザ前提）。

---

## 2. 何を潰すのか — 失敗モードと対策の1対1対応

プロンプトだけのループが壊れる具体例を、**塞ぐツール／制約と1対1**で対応させる。「気をつける」で塞ぐものは1つも無い。

| # | 失敗モード（具体） | 実際に起きる形 | 塞ぐ機構（ツール／制約） | 検出時の返り値 |
|---|---|---|---|---|
| F1 | **自己採点の甘え** | 「まあ9点でいいだろう」と根拠なしに全項目9点を出し、その周で FINAL を宣言 | `score_submit` が各スコアに `evidence` を**必須**（`minItems:1`）。`verification:"auto"` の基準は `evidence.kind:"command"` のみ受理。判定はサーバの閾値ロジック（§6） | `E_EVIDENCE_REQUIRED` / `E_EVIDENCE_KIND` |
| F2 | **周回中にループを忘れる** | 3周目あたりで PLAN/VERIFY を省略し、雑談に戻る | 全ツール応答に `next_action`（次に呼ぶべきツール名と入力の骨格）を埋め込む。状態機械が順序違反を構造的に弾く（§4）。`loop_state` はいつでも呼べる復帰専用ツール | `E_STATE_VIOLATION`（`expected_tools` 付き） |
| F3 | **コンテキスト圧縮で rubric ごと消える** | 長い周回で rubric 本文が要約に飲まれ、基準が曖昧化 | rubric は `PLUGIN_DATA` に永続。`loop_state` が rubric 全文とアンカーを再供給。`ITERATING` 応答は**最低点3基準の全文アンカー**を必ず同梱（§6.4） | （常時再供給。欠落しない） |
| F4 | **基準を後から緩める** | 通らない基準の重みを下げる／アンカーを甘くする／基準を消す | rubric は content-addressed & 版管理。変更は `rubric_amend` 経由のみで、**緩和方向の変更**（重み減・基準削除・アンカー緩和・閾値変更）は `relaxation` として記録され、以後そのセッションは `FINAL` に到達不能（`FINAL_WITH_RELAXATION` は人間の承認トークン必須、§7.3） | `E_THRESHOLD_IMMUTABLE` / 判定 `ESCALATED` |
| F5 | **成果物が変わってないのにスコアだけ上がる** | 同じ文書を出し直して「今読み返したら9点だった」 | `score_submit` は直前に `artifact_commit` された `artifact_digest` に束縛。**digest 不変で1点でも上昇**した提出は拒否 | `E_SCORE_INFLATION`（上がった基準 id を列挙） |
| F6 | **早期 FINAL 宣言** | モデルが「もう十分」と言って停止 | `FINAL` はサーバのみが出す語。ツール出力の `verdict` 以外に FINAL を名乗る経路が無い。閾値未満なら `ITERATING` と `must_fix` が強制的に返る（§6.3） | `verdict:"ITERATING"` |
| F7 | **無限ループ** | 微修正を延々繰り返して終わらない | `max_rounds`（既定12）到達で `STALLED`。停滞検知（既定 N=3 周、加重平均改善 < 0.25）でも `STALLED`。どちらも `escalate` でしか抜けられない（§7） | `verdict:"STALLED"` |
| F8 | **根拠の使い回し** | 前周と同じ引用を貼って点だけ上げる | 各 evidence は `sha256(kind + locator/command + excerpt)` で `evidence_digest` 化。**スコアが上昇した基準**で前周と同一 `evidence_digest` は拒否 | `E_EVIDENCE_STALE` |
| F9 | **一気に9点へジャンプ** | 3点→9点を根拠1個で飛ばす | `max_score_jump`（既定 +3 / 周 / 基準）。超過は `evidence.kind:"command"` かつ `exit_code:0` の根拠が**2件以上**必要（§6.2） | `E_SCORE_JUMP` |
| F10 | **成果物の差し替えごまかし** | 採点後に成果物だけ静かに書き換えて「その版で9点でした」と主張 | `artifact_commit` → `score_submit` の順序を状態機械が強制。`score_submit` は `artifact_digest` を必須引数で受け、サーバ保持値と不一致なら拒否 | `E_DIGEST_MISMATCH` |
| F11 | **評価の空洞化（引用が成果物に無い）** | 存在しない章を根拠として引用 | `locator` 根拠は `excerpt` 必須。サーバは保存済み成果物本文に対し**正規化後の部分一致**を検証。見つからなければ拒否 | `E_EVIDENCE_NOT_FOUND` |
| F12 | **セッションの取り違え／並行上書き** | 別ウィンドウの同名セッションが状態を壊す | `expected_round` による楽観ロック + `PLUGIN_DATA` 上の排他ロック | `E_CONCURRENT` |
| F13 | **サーバ不在で無検証の完了宣言** | MCP 起動失敗時にモデルが素の自己採点で FINAL を出す | `SKILL.md` が縮退規約を持つ：ツールが無い周回では **`FINAL` を名乗ることを禁止**し `UNVERIFIED-COMPLETE` に格下げ、フォールバック journal を残す（§10.3） | （スキル側の規約） |
| F14 | **通信断による二重採点** | ストリームが切れて結果が届かず、同じ `score_submit` を再送 → 周回が2つ進む／停滞カウンタが狂う | `artifact_commit` / `score_submit` に冪等キー `submission_id` を必須化。既出なら保存済み応答をそのまま返す（§7.1 手順 0）。MCP 2026-07-28 はストリーム再開を廃止し再送を前提とするため必須 | （再送は成功扱い。二重適用なし） |
| F15 | **上流の版を知らずに下流を始める** | 「設計書は読んだ」と称して、どの版に対する計画なのか記録せずに計画を書き始める | `loop_open` が `upstream:{session_id, artifact_digest}` を **plan/implement で必須**にし、digest が上流の確定成果物と一致しなければセッションを作らない（§19.2.1） | `E_UPSTREAM_REQUIRED` / `E_UPSTREAM_DIGEST_MISMATCH` |
| F16 | **上流が変わったのに下流が古い合格のまま残る** | 設計を直したのに、その設計から出た実装が `FINAL` のまま放置される | 全ツール呼び出しの入口でピンと上流の現在の確定 digest を比較し、不一致なら下流を `SUPERSEDED` に落とす。`FINAL` でも容赦なく落ちる（§19.3.2） | `state:"SUPERSEDED"` / `E_SUPERSEDED` |
| F17 | **上流の欠陥を下流で辻褄合わせする** | 計画の依存順が間違っているのに、実装側で順番を勝手に変えて設計書と乖離させる | `escalate(action:"kickback")` で上流を再オープンし、下流は `FROZEN` になる。下流だけ進める経路が無い（§19.4） | `E_FROZEN` |
| F18 | **計画に設計外の作業を混ぜる** | 設計書に無い機能を「ついでに」計画へ足す | `plan` 成果物の全タスクに `design_refs` を必須化し、参照先が**ピンした上流設計書に実在すること**をサーバが照合する（§19.5.2） | `E_PLAN_DESIGN_REF` |
| F19 | **テストを消す・skip する・アサートを弱めて green にする** | 落ちるテストを削除／`skip` を増やす／`toBe` を `toBeDefined` に緩めて「全部通った」と主張 | `test_inventory` の前周差分をサーバが取り、説明なき削除・skip 増を拒否。変更したテストファイルには差分の添付を必須化（§19.8.2 / §19.8.3） | `E_TEST_REGRESSION` / `E_TEST_MUTATED_WITHOUT_DIFF` / `E_TEST_NOT_GREEN` |
| F20 | **3モード合計での暴走** | 設計12周・計画8周・実装16周を使い切り、さらに差し戻しで上限がリセットされて終わらない | チェーン合計の上位予算 `chain_max_rounds`（既定28）と差し戻し上限 `chain_max_kickbacks`（既定2）。上乗せは人間承認で1回だけ（§19.10.2） | `E_CHAIN_BUDGET_EXHAUSTED` / `ESCALATED（chain_budget_exhausted）` |

---

## 3. アーキテクチャ

```
┌───────────────────────── host (VS Code / Cursor / Copilot / Codex / Kiro / Claude Code …)
│
│  skills/rubric-loop/SKILL.md   ← ループ手順（PLAN/DO/VERIFY/DECIDE の型）
│        │ 「必ずツールを呼べ」と指示するだけ。判定はしない
│        ▼
│  MCP client ──stdio(既定) / streamable-http──▶ rubric-loop server
│                                                  │
│                                                  ├─ 状態機械（順序強制）
│                                                  ├─ 閾値判定エンジン（FINAL/ITERATING/STALLED）
│                                                  ├─ ごまかし検出（digest / evidence / jump）
│                                                  └─ 永続層  $PLUGIN_DATA/rubric-loop/…
└─────────────────────────────────────────────────────────────────────────
```

責務の線引き（詳細 §10）:

- **スキル** = 手順の記憶（何を書くか、どう直すか）。判定はしない。
- **サーバ** = 状態・判定・監査。文章の良し悪しは判断しないが、**「良いと言ってよいか」は判断する**。

---

## 4. 状態機械

### 4.1 状態遷移図

```
        loop_open(new)
   (無) ──────────────▶ DRAFTING ──artifact_commit──▶ SCORING
                          ▲   ▲                          │
                          │   │                    score_submit
        loop_open(resume) │   │                          │
   (任意状態) ────────────┘   │              ┌───────────┴───────────┬────────────────┐
                              │              ▼                       ▼                ▼
                              └── verdict:ITERATING            verdict:FINAL    verdict:STALLED
                                                                     │                │
                                                                  (終端)         escalate
                                                                                      │
                                                              ┌───────────────────────┴──────────┐
                                                              ▼                                  ▼
                                                        ESCALATED（人間待ち）              ABORTED（終端）
                                                              │
                                              resolution:"continue" + override_token
                                                              ▼
                                                          DRAFTING
```

**3モード拡張後の完全な状態遷移図**（`SUPERSEDED` / `FROZEN` を含む）は §19.9.1 にある。本節の図はそのうち、上流を持たないセッション（`loop_mode:"design"`）で到達しうる範囲である。

### 4.2 状態ごとの呼べる／呼べないツール

| 状態 | 意味 | 呼べる | 呼べない（`E_STATE_VIOLATION`） |
|---|---|---|---|
| （セッション無） | 未初期化 | `loop_open` | 他すべて |
| `DRAFTING` | 成果物を書く/直す周 | `loop_state`, `artifact_commit`, `rubric_amend`, `escalate`, `audit_export` | `score_submit` |
| `SCORING` | 成果物確定済み・採点待ち | `loop_state`, `score_submit`, `escalate`, `audit_export` | `artifact_commit`, `rubric_amend` |
| `STALLED` | 打ち切り条件成立 | `loop_state`, `escalate`, `audit_export` | `artifact_commit`, `score_submit`, `rubric_amend` |
| `ESCALATED` | 人間の判断待ち | `loop_state`, `escalate`（`resolution` 付き）, `audit_export` | `artifact_commit`, `score_submit`, `rubric_amend` |
| `FINAL` | 収束（終端） | `loop_state`, `audit_export` | `artifact_commit`, `score_submit`, `rubric_amend`, `escalate` |
| `ABORTED` | 中断（終端） | `loop_state`, `audit_export` | 上記すべて |
| `SUPERSEDED` | 上流が変わり判定が失効（§19.3） | `loop_state`, `escalate`（`rebase` / `abort`）, `audit_export` | `artifact_commit`, `score_submit`, `rubric_amend` |
| `FROZEN` | 差し戻し中／上流が再オープン中（§19.4） | `loop_state`, `escalate`（`abort`）, `audit_export` | `artifact_commit`, `score_submit`, `rubric_amend` |

**順序違反が構造的に弾かれる根拠**:

1. `score_submit` は `SCORING` でしか受理されない。`SCORING` に入る道は `artifact_commit` だけ → **採点前に必ず成果物版が登録される**（F10 を塞ぐ）。
2. `rubric_amend` は `DRAFTING` でしか受理されない → 「採点結果を見てから基準を緩める」動きは必ず新しい周として監査に残る（F4）。
3. `FINAL` は終端。以後 mutation 系は全拒否 → 事後の書き換えができない。
4. `loop_state` と `audit_export` は全状態で読み取り可能 → 復帰と監査は常に可能（F2 / F3）。
5. `SUPERSEDED` / `FROZEN` は**上流ピンを持つセッションだけ**が到達しうる。`loop_mode:"design"` では構造的に到達不能（証明は §19.9.3）。

### 4.3 ラウンド番号の進み方

- `loop_open`（新規）で `round = 1`、状態 `DRAFTING`。
- `artifact_commit` は `round` を進めない（同一周内で何度でも上書き可。最後の commit が採点対象）。
- `score_submit` が受理され `verdict:"ITERATING"` になった瞬間に `round += 1` して `DRAFTING` へ。
- `verdict` が `FINAL` / `STALLED` のときは `round` を進めない。

---

## 5. rubric スキーマ

### 5.1 構造

rubric は「基準の配列」+「不変ポリシー」。基準ごとに **id / 説明 / 重み / 1点・5点・9点アンカー / 検証手段** を持つ。

```json
{
  "$schema": "https://agent-plugins.org/x/rubric-loop/v1/rubric.json",
  "rubric_version": 1,
  "rubric_digest": "sha256:5b1e0f9c…",
  "created_at": "2026-09-04T09:12:33Z",
  "criteria": [
    {
      "id": "failure-modes",
      "title": "潰す失敗モードの特定",
      "description": "プロンプトのみのループが壊れる具体例を列挙し、塞ぐツール/制約と1対1で対応させる",
      "weight": 3,
      "anchors": {
        "1": "失敗モードが抽象語（『甘えが出る』等）のみで、対策との対応が無い",
        "5": "具体例は3件以上あるが、対策が『注意する』『プロンプトで強調』等で機構になっていない",
        "9": "具体例が10件以上、各々に塞ぐツール名・制約・検出時のエラーコードが1対1で紐づいている"
      },
      "verification": "manual",
      "verify_hint": "§2 の表の各行に『塞ぐ機構』列と『返り値』列が埋まっていること"
    },
    {
      "id": "package-conformance",
      "title": "可搬パッケージ準拠",
      "description": "plugin.json / mcp.json が Agent Plugins 1.0.0 に適合する",
      "weight": 3,
      "anchors": {
        "1": "実物が無い、または $schema が両者で食い違う",
        "5": "実物はあるが command にシェル文字列や変数展開を含む",
        "9": "両者の $schema が一致し、command は単一実行トークン、変数は PLUGIN_ROOT/PLUGIN_DATA のみ、cwd が両ディレクトリ配下、ヘッダに資格情報が無い"
      },
      "verification": "auto",
      "verify_hint": "jq -e で $schema 一致・command の単一トークン性・許可変数のみを検査するコマンドを evidence に添付する"
    }
  ],
  "policy": {
    "scale_min": 1,
    "scale_max": 10,
    "pass_score": 9,
    "pass_weighted_mean": 9.0,
    "max_rounds": 12,
    "stall_window": 3,
    "stall_epsilon": 0.25,
    "max_score_jump": 3,
    "require_command_evidence_for": ["auto"]
  }
}
```

### 5.2 フィールド定義

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `criteria[].id` | string `^[a-z0-9][a-z0-9-]{1,63}$` | ✓ | 一意。以後の全スコアがこの id を参照 |
| `criteria[].title` | string ≤120 | ✓ | 短い名前 |
| `criteria[].description` | string ≤2000 | ✓ | 何を見るか |
| `criteria[].weight` | integer 1–5 | ✓ | 加重平均の重み |
| `criteria[].anchors.1/5/9` | string 1–1000 各 | ✓ | 1点・5点・9点の具体記述。空文字禁止 |
| `criteria[].verification` | `"auto"` / `"manual"` | ✓ | `auto` は `command` 根拠のみ受理 |
| `criteria[].verify_hint` | string ≤1000 | ✓ | 何を見れば／何を実行すれば確認できるか |
| `policy.*` | §5.1 参照 | ✓ | `loop_open` 以後**不変** |

### 5.3 版管理と「こっそり緩める」の監査

- 保存時に正規化 JSON（キー昇順・空白除去・UTF-8 NFC）の SHA-256 を取り `rubric_digest` とする。
- `rubric_amend` は `rubric_version` を +1 し、`rubric/<version>.json` と `rubric_diff/<version>.json` を両方書く。
- サーバは差分を機械分類する:

| 分類 | 条件 | 帰結 |
|---|---|---|
| `addition` | 基準の追加 / `weight` 増加 / `anchors.9` が既存文言を包含したまま伸びる | 許可。`FINAL` 到達可 |
| `clarification` | `description` / `verify_hint` / `title` のみの変更 | 許可。`FINAL` 到達可 |
| `relaxation` | 基準の削除 / `weight` 減少 / `anchors.9` の既存文言が失われる / `verification` を `auto`→`manual` | 許可するが `relaxation_count += 1`。以後、閾値を満たしても `FINAL` は出ず **`ESCALATED`（`reason:"relaxation_pending_approval"`）**。人間が `escalate(resolution:"approve_relaxation", human_token)` を出して初めて `FINAL_WITH_RELAXATION` |
| `policy_change` | `policy.*` の変更 | **常に拒否**（`E_THRESHOLD_IMMUTABLE`）。閾値はセッション開始時に固定 |

「基準を書き換えて通す」経路は、**塞がれる（policy）** か **監査に残り人間の承認を要する（relaxation）** の2択しか無い。

---

## 6. ツール表面

### 6.1 一覧（7ツール・直交）

| # | name | 目的 | 呼べる状態 | 直交性の根拠（なぜ統合しないか） |
|---|---|---|---|---|
| 1 | `loop_open` | セッションの作成／再開。rubric と policy を固定 | 無 / 任意 | 唯一の mutation 開始点。`loop_state` と分けるのは、こちらが副作用ありで `loop_state` は全状態安全な読み取り専用だから |
| 2 | `loop_state` | 状態・rubric 全文・履歴要約・`next_action` を取得 | 全状態 | 文脈喪失からの唯一の復帰口。読み取り専用ゆえ状態機械の制約を受けない |
| 3 | `artifact_commit` | 成果物の版を登録し digest を確定 | `DRAFTING` | 採点と分離することが F5 / F10 の要。統合すると採点時に digest を後付けできる |
| 4 | `score_submit` | 全基準のスコア+根拠を提出し、サーバの判定を受け取る | `SCORING` | 判定を返す唯一のツール。判定専用ツールを別に作らないのは、判定を「提出の副作用」にして自称の余地を消すため |
| 5 | `rubric_amend` | rubric を版として変更 | `DRAFTING` | 変更を必ず版として残すため独立。`loop_open` に統合すると再開のたびに書き換え可能になる |
| 6 | `escalate` | 人間へのエスカレーション／中断／承認の投入 | `DRAFTING` `SCORING` `STALLED` `ESCALATED` | 非終端の非収束状態から抜ける唯一の出口。人間の意思をシステムに入れる専用口 |
| 7 | `audit_export` | 全周回の監査 JSON を書き出す | 全状態 | 読み取り専用の出力。他ツールの応答に混ぜるとペイロードが肥大し圧縮対象になる |

**あえて足していないもの**: `set_score`（部分更新＝ごまかし口）、`list_sessions`（`loop_open` の resume 失敗時に候補を返せば足りる）、`get_artifact`（`audit_export` に含まれる）、`finalize`（判定はサーバが出すのでモデルが呼ぶ余地が無い）。

> **3モード拡張後もツールは7本のまま**である。連鎖・失効・差し戻し・ファイル集合成果物はすべて既存ツールの引数追加で表現した。検討して却下した新規ツール6件とその理由は §19.6.1、3モード対応後の全ツール差分表は §19.6.2 にある。**スキーマの実物は §6.4 に1箇所だけ置く**（同じスキーマを2箇所に置くと片方だけ直す事故が起きるため）。§6.4 の7ツールはすべて3モード対応後の確定版であり、§19.6.3–19.6.5 は「3モード化で何が変わったか」の差分表として §6.4 を指すだけにしてある。名前・目的・入力／出力スキーマの所在・エラー条件の全数を1枚で見たい場合は §19.6.7 の総覧を見ること。

### 6.2 共通の出力エンベロープ

全ツールの `structuredContent` は次を必ず含む（仮定 A5 によりテキストにも同一 JSON を複製）。

```json
{
  "ok": true,
  "session_id": "rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
  "state": "SCORING",
  "round": 3,
  "rubric_version": 1,
  "persistence": "durable",
  "next_action": {
    "tool": "score_submit",
    "why": "成果物 sha256:9ac1… が登録済み。全15基準のスコアと根拠を提出せよ",
    "required_criteria": ["failure-modes", "tool-surface", "…"]
  },
  "warnings": []
}
```

- `persistence`: `"durable"`（PLUGIN_DATA 解決済み）/ `"ephemeral"`（未解決、§8.2）。
- `next_action` は**必ず埋まる**。終端状態でも `{"tool":"audit_export", …}` を返す。これが F2 を塞ぐ。
- 3モード拡張後は、これに加えて `loop_mode` / `chain_id` を常に含み、上流を持つセッションでは `upstream:{artifact_digest, drift:boolean}` も含む（§19.2.1）。

### 6.3 共通エラー条件

| code | 意味 | 発生条件 |
|---|---|---|
| `E_STATE_VIOLATION` | 順序違反 | 現在の状態で許されないツール。`expected_tools` を同梱 |
| `E_SESSION_NOT_FOUND` | 不明セッション | 未知の `session_id`。既存 id の候補を最大10件返す |
| `E_CONCURRENT` | 競合 | `expected_round` 不一致、またはロック取得失敗 |
| `E_VALIDATION` | 入力不正 | 入力 JSON Schema 違反。`path` と `reason` を返す |
| `E_NO_PERSISTENCE` | 永続不能 | PLUGIN_DATA 未解決で `allow_ephemeral` 未指定 |
| `E_INTERNAL` | I/O 失敗 | 永続層の失敗。部分書き込みはしない（tmp + rename） |

3モード拡張で追加されるエラーコード19件は §19.6.6 にまとめてある。ツール別の全数は §19.6.7。返し方（`structuredContent.error.code` の文字列）は同じ。

> `E_*` は JSON-RPC エラーではなく**ツール結果の `structuredContent.error.code`**（文字列）として返す。MCP 2026-07-28 のエラーコード割り当て方針（`-32020`〜`-32099` は仕様予約）と衝突しないための選択（§18.1 #13）。

---

### 6.4 ツール定義（入力／出力 JSON Schema 実物）

すべて JSON Schema draft 2020-12。`additionalProperties:false` を全オブジェクトに付け、未知フィールドは `E_VALIDATION` で弾く。

MCP 2026-07-28 で `inputSchema` / `outputSchema` は JSON Schema 2020-12 の任意キーワードを使えるようになり、`$ref` の解決要件と合成キーワードの資源上限も規定された。本設計は `allOf` / `if-then` / `oneOf` を使うが、**`$ref` は使わず各スキーマを自己完結**させる（旧リビジョンのクライアントでも読めるようにするため。可搬性の判断であって仕様上の制約ではない）。

---

#### 6.4.1 `loop_open`

**目的**: セッションを作成または再開する。作成時に rubric・policy・`loop_mode`・上流ピンを固定する。

> **これは3モード対応後の版**（`loop_mode` / `upstream` / `rubric_preset` / `submission_id` を含む）。3モード化で何が変わったかの差分だけを読みたい場合は §19.6.3 を見ること。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["mode", "submission_id"],
  "properties": {
    "mode": {
      "enum": ["create", "resume", "create_or_resume"],
      "description": "セッションを新規作成するか、既存を再開するか。ループのモード(design/plan/implement)とは別概念"
    },
    "submission_id": {
      "type": "string", "minLength": 8, "maxLength": 128,
      "description": "冪等キー。再送で二重にセッションが作られるのを防ぐ。同じ値なら保存済みの応答をそのまま返す"
    },
    "session_id": {
      "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$",
      "description": "サーバ発行ハンドル。resume 時のみ指定。create では指定禁止"
    },
    "label": { "type": "string", "minLength": 1, "maxLength": 120 },
    "loop_mode": {
      "enum": ["design", "plan", "implement"],
      "description": "ループのモード。create 時に必須で、以後 immutable"
    },
    "upstream": {
      "type": "object",
      "additionalProperties": false,
      "required": ["session_id", "artifact_digest"],
      "properties": {
        "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
        "artifact_digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" }
      },
      "description": "上流の確定成果物へのピン。plan/implement では必須、design では指定禁止"
    },
    "task": { "type": "string", "minLength": 20, "maxLength": 20000 },
    "artifact_kind": { "enum": ["markdown", "text", "plan", "fileset"] },
    "rubric_preset": {
      "enum": ["design", "plan", "implement"],
      "description": "presets/<name>.json を rubric の初期値として読み込む。rubric と併用した場合は rubric が優先し、preset は無視される"
    },
    "rubric": {
      "type": "object",
      "additionalProperties": false,
      "required": ["criteria"],
      "properties": {
        "criteria": {
          "type": "array", "minItems": 1, "maxItems": 40,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "statement", "weight", "anchors", "verification"],
            "properties": {
              "id": { "type": "string", "pattern": "^[a-z0-9_]{1,40}$" },
              "statement": { "type": "string", "minLength": 10, "maxLength": 2000 },
              "weight": { "type": "number", "exclusiveMinimum": 0, "maximum": 10 },
              "verification": { "enum": ["auto", "manual"] },
              "anchors": {
                "type": "object",
                "additionalProperties": false,
                "required": ["1", "5", "9"],
                "properties": {
                  "1": { "type": "string", "minLength": 5, "maxLength": 1000 },
                  "5": { "type": "string", "minLength": 5, "maxLength": 1000 },
                  "9": { "type": "string", "minLength": 5, "maxLength": 1000 }
                }
              }
            }
          }
        },
        "policy": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "pass_score": { "type": "integer", "minimum": 1, "maximum": 10 },
            "pass_weighted_mean": { "type": "number", "minimum": 1, "maximum": 10 },
            "max_rounds": { "type": "integer", "minimum": 1, "maximum": 50 },
            "stall_window": { "type": "integer", "minimum": 2, "maximum": 10 },
            "stall_epsilon": { "type": "number", "minimum": 0, "maximum": 5 },
            "max_score_jump": { "type": "integer", "minimum": 1, "maximum": 9 },
            "require_command_evidence_for": {
              "type": "array", "items": { "enum": ["auto", "manual"] }, "uniqueItems": true
            },
            "chain_max_rounds": { "type": "integer", "minimum": 1, "maximum": 200 }
          }
        }
      }
    },
    "allow_ephemeral": { "type": "boolean", "default": false }
  },
  "allOf": [
    {
      "if": { "properties": { "mode": { "const": "create" } }, "required": ["mode"] },
      "then": {
        "required": ["task", "loop_mode"],
        "not": { "required": ["session_id"] }
      }
    },
    {
      "if": { "properties": { "mode": { "const": "resume" } }, "required": ["mode"] },
      "then": {
        "anyOf": [ { "required": ["session_id"] }, { "required": ["label"] } ]
      }
    },
    {
      "if": {
        "properties": { "loop_mode": { "enum": ["plan", "implement"] } },
        "required": ["loop_mode"]
      },
      "then": { "required": ["upstream"] }
    },
    {
      "if": {
        "properties": { "loop_mode": { "const": "design" } },
        "required": ["loop_mode"]
      },
      "then": { "not": { "required": ["upstream"] } }
    }
  ]
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "rubric", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "enum": ["DRAFTING", "SCORING", "STALLED", "ESCALATED", "FINAL", "ABORTED"] },
    "round": { "type": "integer", "minimum": 1 },
    "rubric_version": { "type": "integer", "minimum": 1 },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "resumed": { "type": "boolean" },
    "label": { "type": "string" },
    "handle_minted": {
      "type": "boolean",
      "description": "この呼び出しで session_id を新規発行したか。true のとき、以後の全ツール呼び出しはこの値を通常のツール引数として渡す"
    },
    "state_dir": { "type": "string", "description": "実際に解決された永続ディレクトリの絶対パス" },
    "rubric": { "type": "object", "description": "現行 rubric の全文（criteria + policy + rubric_digest）" },
    "task": { "type": "string" },
    "history": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["round", "artifact_digest", "weighted_mean", "min_score", "verdict"],
        "properties": {
          "round": { "type": "integer" },
          "artifact_digest": { "type": "string" },
          "weighted_mean": { "type": "number" },
          "min_score": { "type": "integer" },
          "verdict": { "enum": ["ITERATING", "FINAL", "FINAL_WITH_RELAXATION", "STALLED", "ESCALATED"] }
        }
      }
    },
    "next_action": {
      "type": "object",
      "additionalProperties": false,
      "required": ["tool", "why"],
      "properties": {
        "tool": { "type": "string" },
        "why": { "type": "string" },
        "required_criteria": { "type": "array", "items": { "type": "string" } }
      }
    },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

**エラー条件**

| code | 条件 |
|---|---|
| `E_VALIDATION` | rubric の必須欠落、`id` 重複、アンカー空文字、`weight` 範囲外 |
| `E_HANDLE_NOT_ACCEPTED` | `mode:"create"` で `session_id` を指定した（ハンドルはサーバが発行する） |
| `E_SESSION_NOT_FOUND` | `mode:"resume"` で未知の `session_id` / `label`（候補を `{session_id, label, state, round, updated_at}` で最大10件返す） |
| `E_AMBIGUOUS_LABEL` | `mode:"resume"` で `label` が複数のセッションに一致（候補を返す。`session_id` での再指定を求める） |
| `E_NO_PERSISTENCE` | PLUGIN_DATA 未解決かつ `allow_ephemeral` 未指定 |
| `E_RUBRIC_ON_RESUME` | `mode:"resume"` で `rubric` を渡した（変更は `rubric_amend` 経由のみ） |
| `E_UPSTREAM_REQUIRED` | `loop_mode` が `plan`/`implement` なのに `upstream` が無い |
| `E_UPSTREAM_NOT_ALLOWED` | `loop_mode:"design"` に `upstream` を渡した |
| `E_UPSTREAM_NOT_FOUND` | `upstream.session_id` が存在しない |
| `E_UPSTREAM_NOT_FINAL` | 上流が `FINAL` / `FINAL_WITH_RELAXATION` のいずれでもない |
| `E_UPSTREAM_MODE_MISMATCH` | plan←design / implement←plan の関係になっていない |
| `E_UPSTREAM_DIGEST_MISMATCH` | ピン指定の digest が上流の確定成果物と一致しない |
| `E_CHAIN_BUDGET_EXHAUSTED` | チェーン合計周回が `chain_max_rounds` を超えている（§19.10.2） |
| `E_INTERNAL` | 永続層 I/O 失敗 |

**`allOf` の4分岐が何を守っているか**: ① `create` は `task` と `loop_mode` を必須にし `session_id` を禁じる（ハンドルはサーバが発行する・F5）。② `resume` は `session_id` か `label` のどちらかを必ず要る（どちらも無い再開は復帰口にならない）。③ `plan`/`implement` は `upstream` 必須（上流の版を知らずに下流を始める F15 を、スキーマの段階で不可能にする）。④ `design` は `upstream` 禁止（上流を持てるようにすると `SUPERSEDED` が design にも到達しうることになり、§19.9.3 の不到達証明が崩れる）。

---

#### 6.4.2 `loop_state`

**目的**: 現在の状態・rubric 全文・履歴・次に呼ぶべきツールを取得する。文脈が飛んだ時の唯一の復帰口。全状態で呼べる。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "include": {
      "type": "array", "uniqueItems": true,
      "items": { "enum": ["rubric", "history", "last_scores", "artifact_head", "must_fix", "upstream", "chain"] },
      "default": ["rubric", "history", "last_scores", "must_fix"]
    },
    "artifact_head_bytes": { "type": "integer", "minimum": 0, "maximum": 20000, "default": 0 },
    "upstream_head_bytes": {
      "type": "integer", "minimum": 0, "maximum": 200000, "default": 0,
      "description": "include に upstream があるとき、上流の確定成果物を先頭から何バイト返すか。0 ならメタデータのみ"
    }
  }
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "enum": ["DRAFTING", "SCORING", "STALLED", "ESCALATED", "FINAL", "FINAL_WITH_RELAXATION", "SUPERSEDED", "FROZEN", "ABORTED"] },
    "round": { "type": "integer" },
    "rubric_version": { "type": "integer" },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "loop_mode": { "enum": ["design", "plan", "implement"] },
    "task": { "type": "string" },
    "rubric": { "type": "object" },
    "history": { "type": "array", "items": { "type": "object" } },
    "last_scores": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["criterion_id", "score", "passed"],
        "properties": {
          "criterion_id": { "type": "string" },
          "score": { "type": "integer" },
          "passed": { "type": "boolean" },
          "rationale": { "type": "string" }
        }
      }
    },
    "must_fix": {
      "type": "array",
      "description": "最低点から昇順。ITERATING 中は必ず1件以上",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["criterion_id", "score", "gap", "anchor_9", "verify_hint"],
        "properties": {
          "criterion_id": { "type": "string" },
          "score": { "type": "integer" },
          "gap": { "type": "integer" },
          "anchor_9": { "type": "string" },
          "verify_hint": { "type": "string" },
          "last_weakness_note": { "type": "string" }
        }
      }
    },
    "current_artifact": {
      "type": "object",
      "additionalProperties": false,
      "required": ["digest", "bytes", "committed_at"],
      "properties": {
        "digest": { "type": "string" },
        "bytes": { "type": "integer" },
        "committed_at": { "type": "string", "format": "date-time" },
        "head": { "type": "string" }
      }
    },
    "upstream_artifact": {
      "type": "object",
      "additionalProperties": false,
      "required": ["session_id", "loop_mode", "state", "pinned_digest", "current_digest", "drifted"],
      "properties": {
        "session_id": { "type": "string" },
        "loop_mode": { "enum": ["design", "plan"] },
        "state": { "type": "string" },
        "pinned_digest": { "type": "string" },
        "current_digest": { "type": "string" },
        "drifted": { "type": "boolean", "description": "pinned != current。true なら本セッションは SUPERSEDED か FROZEN のはず（§19.3）" },
        "head": { "type": "string", "description": "upstream_head_bytes ぶんの本文" }
      }
    },
    "chain": {
      "type": "object",
      "additionalProperties": false,
      "required": ["chain_id", "links", "chain_rounds", "chain_max_rounds", "kickbacks"],
      "properties": {
        "chain_id": { "type": "string", "pattern": "^ch_[0-9A-HJKMNP-TV-Z]{26}$" },
        "links": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["session_id", "loop_mode", "state", "rounds"],
            "properties": {
              "session_id": { "type": "string" },
              "loop_mode": { "enum": ["design", "plan", "implement"] },
              "state": { "type": "string" },
              "rounds": { "type": "integer" }
            }
          }
        },
        "chain_rounds": { "type": "integer" },
        "chain_max_rounds": { "type": "integer" },
        "kickbacks": { "type": "integer" }
      }
    },
    "next_action": { "type": "object" },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

**エラー条件**: `E_VALIDATION`（入力スキーマ違反。未知の `include` 値など） / `E_SESSION_NOT_FOUND` / `E_INTERNAL`。状態違反は起こらない（全状態で許可）。`include:["upstream"]` を上流を持たない design セッションで指定した場合はエラーにせず、`upstream_artifact` を省いて `warnings:["no_upstream"]` を返す（復帰口が状態によって失敗すると、文脈が飛んだときの唯一の出口が塞がるため）。

---

#### 6.4.3 `artifact_commit`

**目的**: この周の成果物（単一本文 `content` またはファイル集合 `files`）を登録し、`artifact_digest` を確定して `SCORING` に遷移する。

> **これは3モード対応後の版**。`content` と `files` は `oneOf` で、`fileset` では `test_inventory` が必須になる。差分だけを読みたい場合は §19.6.4。

> **`source_path`（`content` の代替経路）**: `markdown` / `text` / `plan` の成果物がディスク上にある場合、本文を `content` で送らず `source_path` にファイルパスを渡す。サーバは **ワークスペース根**（`data_dir` の basename が `.strict-goal` ならその親、`--data-dir` 直指定ならその `data_dir` 自身）配下に限定してパスを解決し（相対パスは根からの相対、絶対パスは根の内側のみ許容）、読んだ本文を以降 `content` と完全に同じ経路（正規化・内容アドレス保存・diff・見出し検査・予算警告）で扱う。`content` / `source_path` / `files` はちょうど 1 つだけ指定する（違反は `E_VALIDATION reason:"oneOf_content_or_files"`）。根の外・不在・非ファイル・空は `E_VALIDATION` の `reason` が `outside_workspace` / `source_not_found` / `source_not_file` / `source_empty`。受理時は `rounds/<round>.commit.json` に根からの相対パスを `source_path` として記録する。動機: 20–30KB の設計書を毎周モデル出力で往復させると周あたり 1 万トークン超の出力とコンテキスト肥大（→自動コンパクション）を招くため（2026-09-18 ベンチマーク `tr_0Q2T23FM1JT2KQDA6C6DWYNMS1` の実測）。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id", "submission_id", "expected_round", "change_note"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "submission_id": { "type": "string", "minLength": 8, "maxLength": 128 },
    "expected_round": { "type": "integer", "minimum": 1 },
    "content": {
      "type": "string", "minLength": 1, "maxLength": 1000000,
      "description": "artifact_kind が markdown/text/plan のときの成果物全文。差分ではなく全文"
    },
    "files": {
      "type": "array", "minItems": 1, "maxItems": 5000,
      "description": "artifact_kind が fileset のときのマニフェスト",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["path", "sha256", "bytes", "role"],
        "properties": {
          "path": { "type": "string", "minLength": 1, "maxLength": 1024 },
          "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "bytes": { "type": "integer", "minimum": 0, "maximum": 1073741824 },
          "role": { "enum": ["source", "test", "config", "doc", "generated"] }
        }
      }
    },
    "manifest_command": { "type": "string", "minLength": 3, "maxLength": 1000 },
    "manifest_output_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "test_inventory": {
      "type": "object",
      "additionalProperties": false,
      "required": ["source_command", "source_exit_code", "source_output_sha256", "counts", "tests"],
      "properties": {
        "source_command": { "type": "string", "minLength": 3, "maxLength": 1000 },
        "source_exit_code": { "type": "integer", "minimum": -256, "maximum": 255 },
        "source_output_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "counts": {
          "type": "object",
          "additionalProperties": false,
          "required": ["total", "passed", "failed", "skipped"],
          "properties": {
            "total":   { "type": "integer", "minimum": 0 },
            "passed":  { "type": "integer", "minimum": 0 },
            "failed":  { "type": "integer", "minimum": 0 },
            "skipped": { "type": "integer", "minimum": 0 }
          }
        },
        "tests": {
          "type": "array", "minItems": 0, "maxItems": 5000,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "file", "status"],
            "properties": {
              "id": { "type": "string", "minLength": 1, "maxLength": 500 },
              "file": { "type": "string", "minLength": 1, "maxLength": 1024 },
              "status": { "enum": ["passed", "failed", "skipped"] }
            }
          }
        },
        "removed_tests": {
          "type": "array", "maxItems": 5000,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["id", "reason"],
            "properties": {
              "id": { "type": "string", "minLength": 1, "maxLength": 500 },
              "reason": { "type": "string", "minLength": 20, "maxLength": 1000 }
            }
          },
          "description": "前周から消したテスト。申告なく減ると E_TEST_REGRESSION"
        },
        "diffs": {
          "type": "array", "maxItems": 200,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["file", "command", "output_excerpt", "output_sha256"],
            "properties": {
              "file": { "type": "string", "maxLength": 1024 },
              "command": { "type": "string", "maxLength": 1000 },
              "output_excerpt": { "type": "string", "minLength": 1, "maxLength": 20000 },
              "output_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" }
            }
          },
          "description": "内容が変わったテストファイルの差分。§19.8.3"
        }
      }
    },
    "change_note": { "type": "string", "minLength": 10, "maxLength": 4000 },
    "addresses": {
      "type": "array", "uniqueItems": true,
      "items": { "type": "string", "pattern": "^[a-z0-9_]{1,40}$" }
    },
    "source_path": { "type": "string", "maxLength": 4096 }
  },
  "oneOf": [
    { "required": ["content"], "not": { "required": ["files"] } },
    { "required": ["files", "manifest_command", "manifest_output_sha256"],
      "not": { "required": ["content"] } }
  ]
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "artifact", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "const": "SCORING" },
    "round": { "type": "integer" },
    "rubric_version": { "type": "integer" },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "artifact": {
      "type": "object",
      "additionalProperties": false,
      "required": ["digest", "bytes", "unchanged", "previous_digest"],
      "properties": {
        "digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
        "bytes": { "type": "integer" },
        "unchanged": { "type": "boolean", "description": "直前の周の成果物と同一なら true" },
        "previous_digest": { "type": ["string", "null"] },
        "diff": {
          "type": "object",
          "additionalProperties": false,
          "required": ["added_lines", "removed_lines", "changed_ratio"],
          "properties": {
            "added_lines": { "type": "integer" },
            "removed_lines": { "type": "integer" },
            "added_files": { "type": "integer", "description": "artifact_kind が fileset のときのみ" },
            "removed_files": { "type": "integer", "description": "同上" },
            "changed_files": { "type": "integer", "description": "同上。パスが同じで sha256 が違うもの" },
            "changed_ratio": { "type": "number", "minimum": 0, "maximum": 1,
              "description": "content では行ベース、fileset ではファイル件数ベース（定義は §19.5.3）" }
          }
        }
      }
    },
    "next_action": { "type": "object" },
    "warnings": {
      "type": "array", "items": { "type": "string" },
      "description": "次を必ず含む: (a) unchanged:true のとき『この周でスコアを上げる提出は拒否される』, (b) changed_ratio >= 0.9 のとき near_total_rewrite（ほぼ全書き換え＝前周からの連続性が無い）, (c) bytes が前周の 0.5 倍未満のとき suspicious_shrink（全文でなく差分を渡した疑い）, (d) (b) と (c) が同時に成立し、かつ bytes が絶対的に極小（既定 200 バイト未満）かつ前周 bytes がその十倍以上のとき destructive_overwrite（プレースホルダ等での破壊的上書きを疑う複合警告）。いずれも拒否はせず、監査 rounds[].artifact.warnings に残す"
    }
  }
}
```

**エラー条件**

| code | 条件 |
|---|---|
| `E_STATE_VIOLATION` | `DRAFTING` 以外で呼ばれた |
| `E_CONCURRENT` | `expected_round` != サーバの `round` |
| `E_VALIDATION` | `content` 空、`change_note` 20文字未満、1MB 超 |
| `E_ADDRESS_MISSING` | `round>=2` で `addresses` が前周 `must_fix[0].criterion_id` を含まない |
| `E_ARTIFACT_KIND_MISMATCH` | セッションの `artifact_kind` と、渡された `content`/`files` が食い違う |
| `E_MANIFEST_UNVERIFIABLE` | `files` を渡したのに `manifest_command` / `manifest_output_sha256` が欠けている |
| `E_TEST_INVENTORY_REQUIRED` | `artifact_kind:"fileset"` なのに `test_inventory` が無い |
| `E_TEST_MUTATED_WITHOUT_DIFF` | `role:"test"` のファイルの `sha256` が変わったのに `test_inventory.diffs` に該当ファイルの差分が無い（§19.8.2 R4） |
| `E_PLAN_SCHEMA` | `artifact_kind:"plan"` の `content` が JSON として不正、または §19.5.2 のスキーマ不適合 |
| `E_PLAN_INVALID` | 循環依存・幽霊依存・`id` 重複・`acceptance`/`verify` 欠落（§19.5.2 の受理条件） |
| `E_PLAN_DESIGN_REF` | `design_refs` の参照先が、ピン止めした上流設計書に（正規化後の部分一致で）存在しない |
| `E_FROZEN` | セッションが `FROZEN`（上流が差し戻しを受けている）。先に `escalate{action:"rebase"}` が要る |
| `E_SUPERSEDED` | セッションが `SUPERSEDED`（上流が変わった）。先に `escalate{action:"rebase"}` が要る |
| `E_INTERNAL` | 永続層 I/O 失敗 |

---

#### 6.4.4 `score_submit`

**目的**: 全基準のスコアと根拠を提出する。**判定を返す唯一のツール**。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id", "submission_id", "expected_round", "artifact_digest", "scores"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "submission_id": {
      "type": "string", "pattern": "^[A-Za-z0-9._-]{8,64}$",
      "description": "呼び出しごとにクライアントが生成する冪等キー。再送時は保存済みの判定をそのまま返し、周回を二重に進めない"
    },
    "expected_round": { "type": "integer", "minimum": 1 },
    "artifact_digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
    "scores": {
      "type": "array", "minItems": 1, "maxItems": 40,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["criterion_id", "score", "rationale", "weakness", "evidence"],
        "properties": {
          "criterion_id": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]{1,63}$" },
          "score": { "type": "integer", "minimum": 1, "maximum": 10 },
          "rationale": {
            "type": "string", "minLength": 40, "maxLength": 2000,
            "description": "そのスコアである理由。アンカーとの対応を書く"
          },
          "weakness": {
            "type": "string", "minLength": 10, "maxLength": 2000,
            "description": "まだ弱い点。score=10 のときのみ 'none' を許す"
          },
          "evidence": {
            "type": "array", "minItems": 1, "maxItems": 10,
            "items": {
              "oneOf": [
                {
                  "type": "object",
                  "title": "locator evidence",
                  "additionalProperties": false,
                  "required": ["kind", "locator", "excerpt"],
                  "properties": {
                    "kind": { "const": "locator" },
                    "locator": { "type": "string", "minLength": 1, "maxLength": 200,
                      "description": "成果物内の位置（節番号・見出し・行範囲）" },
                    "excerpt": { "type": "string", "minLength": 20, "maxLength": 2000,
                      "description": "登録済み成果物に実在する文字列。サーバが部分一致を検証する" }
                  }
                },
                {
                  "type": "object",
                  "title": "command evidence",
                  "additionalProperties": false,
                  "required": ["kind", "command", "exit_code", "output_excerpt", "output_sha256"],
                  "properties": {
                    "kind": { "const": "command" },
                    "command": { "type": "string", "minLength": 3, "maxLength": 1000,
                      "description": "第三者が再実行できる形。パイプ可（サーバは実行しない・仮定 A4）" },
                    "exit_code": { "type": "integer", "minimum": -256, "maximum": 255 },
                    "output_excerpt": { "type": "string", "minLength": 1, "maxLength": 8000 },
                    "output_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$",
                      "description": "出力全体の SHA-256。監査時の再実行照合に使う" },
                    "target_digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$",
                      "description": "そのコマンドを実行した対象のマニフェスト digest。implement モードでは必須で、登録済みの最新 digest と一致しなければ E_EVIDENCE_TARGET（古い実行結果の使い回しを防ぐ）" }
                  }
                },
                {
                  "type": "object",
                  "title": "upstream evidence",
                  "additionalProperties": false,
                  "required": ["kind", "upstream_locator", "excerpt"],
                  "properties": {
                    "kind": { "const": "upstream" },
                    "upstream_locator": { "type": "string", "minLength": 1, "maxLength": 200,
                      "description": "上流の確定成果物内の位置。plan なら tasks[3].verify[0] のような指定でよい" },
                    "excerpt": { "type": "string", "minLength": 20, "maxLength": 2000,
                      "description": "上流ピンの成果物に実在する文字列。サーバが正規化後に部分一致を検証する。design モードで使うと E_UPSTREAM_NOT_ALLOWED" }
                  }
                }
              ]
            }
          }
        }
      }
    },
    "self_verdict_note": {
      "type": "string", "maxLength": 1000,
      "description": "モデルの所感。判定式には一切入らない（記録のみ）"
    }
  }
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "verdict", "evaluation", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "enum": ["DRAFTING", "SCORING", "FINAL", "STALLED", "ESCALATED"] },
    "round": { "type": "integer", "description": "ITERATING なら既に +1 された次の周番号" },
    "rubric_version": { "type": "integer" },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "verdict": { "enum": ["ITERATING", "FINAL", "FINAL_WITH_RELAXATION", "STALLED", "ESCALATED"] },
    "verdict_reason": {
      "enum": ["below_pass_score", "below_weighted_mean", "all_criteria_passed",
               "max_rounds_reached", "no_improvement", "relaxation_pending_approval"]
    },
    "evaluation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["scored_round", "artifact_digest", "weighted_mean", "min_score", "passed_count", "total_count", "per_criterion"],
      "properties": {
        "scored_round": { "type": "integer" },
        "artifact_digest": { "type": "string" },
        "weighted_mean": { "type": "number" },
        "min_score": { "type": "integer" },
        "passed_count": { "type": "integer" },
        "total_count": { "type": "integer" },
        "improvement": { "type": "number", "description": "前周の weighted_mean からの差" },
        "per_criterion": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": ["criterion_id", "score", "previous_score", "passed"],
            "properties": {
              "criterion_id": { "type": "string" },
              "score": { "type": "integer" },
              "previous_score": { "type": ["integer", "null"], "description": "直前に受理された提出の同 id のスコア。初回または rubric_amend で追加された新基準は null で、その場合インフレ/ジャンプ/新規性の検査はスキップされる" },
              "passed": { "type": "boolean" },
              "evidence_digests": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    },
    "must_fix": {
      "type": "array",
      "description": "ITERATING のとき最低点から昇順で必ず1件以上。同点は weight 降順",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["criterion_id", "score", "gap", "anchor_9", "verify_hint", "weakness"],
        "properties": {
          "criterion_id": { "type": "string" },
          "score": { "type": "integer" },
          "gap": { "type": "integer" },
          "anchor_9": { "type": "string" },
          "verify_hint": { "type": "string" },
          "weakness": { "type": "string" }
        }
      }
    },
    "stall": {
      "type": "object",
      "additionalProperties": false,
      "required": ["rounds_without_improvement", "stall_window", "rounds_remaining"],
      "properties": {
        "rounds_without_improvement": { "type": "integer" },
        "stall_window": { "type": "integer" },
        "rounds_remaining": { "type": "integer" }
      }
    },
    "next_action": { "type": "object" },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

**エラー条件（ごまかし検出を含む）**

| code | 条件 | 返す詳細 |
|---|---|---|
| `E_VALIDATION` | 入力 JSON Schema 違反（`rationale` が 40 文字未満、未知フィールド、`scores` の型不正など）。**以下のごまかし検出はすべてスキーマ通過後に評価する** | `path`, `reason` |
| `E_STATE_VIOLATION` | `SCORING` 以外 | `expected_tools` |
| `E_CONCURRENT` | `expected_round` 不一致 | サーバ側 `round` |
| `E_DIGEST_MISMATCH` | `artifact_digest` が登録済みの最新 commit と不一致 | 期待 digest |
| `E_INCOMPLETE_SCORES` | rubric の全 `criterion_id` を網羅していない／未知 id を含む | 欠落 id 一覧 |
| `E_EVIDENCE_REQUIRED` | `evidence` 空（スキーマで `minItems:1`。防御的に二重チェック） | criterion_id |
| `E_EVIDENCE_KIND` | `verification:"auto"` の基準に `command` 根拠が1つも無い | criterion_id |
| `E_EVIDENCE_NOT_FOUND` | `locator` 根拠の `excerpt` が登録済み成果物本文に（正規化後）存在しない | criterion_id, excerpt 先頭80字 |
| `E_EVIDENCE_STALE` | スコアが上昇した基準で、前周と同一の `evidence_digest` しか無い | criterion_id, 重複 digest |
| `E_SCORE_INFLATION` | `artifact.unchanged == true` なのに1つでもスコアが上昇 | 上昇した criterion_id と前後スコア |
| `E_SCORE_JUMP` | 上げ幅 > `max_score_jump` かつ `exit_code:0` の `command` 根拠が2件未満 | criterion_id, delta |
| `E_WEAKNESS_REQUIRED` | `score < 10` なのに `weakness` が `"none"` | criterion_id |
| `E_EVIDENCE_TARGET` | implement モードの `command` 根拠に `target_digest` が無い、または現在のマニフェスト digest と不一致 | expected, actual |
| `E_TEST_REGRESSION` | テスト総数減 or `skipped` 増を申告なしに行い、かつスコアが上がった（§19.8.2 R1/R2） | prev, now, raised_criteria |
| `E_TEST_NOT_GREEN` | `counts.failed > 0` または `source_exit_code != 0` なのに auto 基準に9以上を付けた（§19.8.2 R3） | criteria |
| `E_UPSTREAM_NOT_ALLOWED` | `loop_mode:"design"` のセッションで `kind:"upstream"` の根拠を使った | — |
| `E_FROZEN` / `E_SUPERSEDED` | セッションが `FROZEN` / `SUPERSEDED`（先に rebase が要る） | upstream_session_id / pinned, current |
| `E_CHAIN_BUDGET_EXHAUSTED` | チェーン合計周回が上限を超えた。**ただし今回の提出が合格判定になる場合は超過していても判定を返す**（§19.10.2） | chain_rounds, limit |
| `E_INTERNAL` | 永続層 I/O 失敗 | — |

> エラー時はラウンドを進めず、状態も `SCORING` のまま。提出は**丸ごと拒否**し、部分採用はしない（部分採用は F1 の抜け道になる）。拒否された提出も `rounds/<n>.rejected/<seq>.json` に記録され、監査に残る。

---

#### 6.4.5 `rubric_amend`

**目的**: rubric を新しい版として変更し、緩和方向の変更を監査に残す。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id", "submission_id", "expected_round", "criteria", "reason"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "submission_id": {
      "type": "string", "pattern": "^[A-Za-z0-9._-]{8,128}$",
      "description": "冪等キー。再送時は保存済みの結果を返し、rubric_version を二重に上げない（§20.2 C2）"
    },
    "expected_round": { "type": "integer", "minimum": 1 },
    "criteria": {
      "type": "array", "minItems": 1, "maxItems": 40,
      "description": "新しい criteria の全文（差分ではない）。スキーマは loop_open.rubric.criteria と同一",
      "items": { "type": "object" }
    },
    "reason": { "type": "string", "minLength": 40, "maxLength": 2000 },
    "acknowledge_relaxation": {
      "type": "boolean", "default": false,
      "description": "緩和分類になることを承知している場合のみ true。false で緩和判定なら拒否"
    }
  }
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "classification", "diff", "final_reachable", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "const": "DRAFTING" },
    "round": { "type": "integer" },
    "rubric_version": { "type": "integer", "description": "+1 された新版" },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "classification": { "enum": ["addition", "clarification", "relaxation", "mixed"] },
    "diff": {
      "type": "object",
      "additionalProperties": false,
      "required": ["added", "removed", "weight_changes", "anchor_changes"],
      "properties": {
        "added": { "type": "array", "items": { "type": "string" } },
        "removed": { "type": "array", "items": { "type": "string" } },
        "weight_changes": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false,
            "required": ["criterion_id", "from", "to"],
            "properties": { "criterion_id": { "type": "string" }, "from": { "type": "integer" }, "to": { "type": "integer" } }
          }
        },
        "anchor_changes": {
          "type": "array",
          "items": {
            "type": "object", "additionalProperties": false,
            "required": ["criterion_id", "anchor", "direction"],
            "properties": {
              "criterion_id": { "type": "string" },
              "anchor": { "enum": ["1", "5", "9"] },
              "direction": { "enum": ["stricter", "looser", "reworded"] }
            }
          }
        }
      }
    },
    "relaxation_count": { "type": "integer" },
    "final_reachable": {
      "type": "boolean",
      "description": "false なら以後 FINAL は出ず、人間承認による FINAL_WITH_RELAXATION のみ"
    },
    "next_action": { "type": "object" },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

**エラー条件**

| code | 条件 |
|---|---|
| `E_STATE_VIOLATION` | `DRAFTING` 以外 |
| `E_CONCURRENT` | `expected_round` 不一致 |
| `E_THRESHOLD_IMMUTABLE` | `policy` を変更しようとした（入力に `policy` が無いのは仕様。`additionalProperties:false` により送信自体が `E_VALIDATION`） |
| `E_RELAXATION_UNACKNOWLEDGED` | 緩和分類なのに `acknowledge_relaxation:false` |
| `E_VALIDATION` | criteria のスキーマ違反、id 重複 |
| `E_INTERNAL` | I/O 失敗 |

---

#### 6.4.6 `escalate`

**目的**: 人間へエスカレーションする／中断する／人間の判断をシステムに投入する。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id", "submission_id", "action", "note"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "submission_id": { "type": "string", "minLength": 8, "maxLength": 128 },
    "action": {
      "enum": ["request_human", "resolve", "abort", "reopen", "rebase", "kickback"]
    },
    "note": { "type": "string", "minLength": 40, "maxLength": 4000 },
    "resolution": { "enum": ["continue", "accept_as_is", "relax_rubric", "abort"] },
    "human_token": { "type": "string", "minLength": 16, "maxLength": 256 },
    "upstream_digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
    "upstream_content": { "type": "string", "maxLength": 1000000 },
    "target_criteria": {
      "type": "array", "minItems": 1, "uniqueItems": true,
      "items": { "type": "string", "pattern": "^[a-z0-9_]{1,40}$" }
    }
  },
  "allOf": [
    { "if": { "properties": { "action": { "const": "resolve" } }, "required": ["action"] },
      "then": { "required": ["resolution", "human_token"] } },
    { "if": { "properties": { "action": { "const": "reopen" } }, "required": ["action"] },
      "then": { "required": ["human_token"] } },
    { "if": { "properties": { "action": { "const": "kickback" } }, "required": ["action"] },
      "then": { "required": ["human_token", "target_criteria"] } },
    { "if": { "properties": { "action": { "const": "rebase" } }, "required": ["action"] },
      "then": { "required": ["upstream_digest"] } }
  ]
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "escalation", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "enum": ["ESCALATED", "DRAFTING", "FINAL_WITH_RELAXATION", "ABORTED", "FINAL"] },
    "round": { "type": "integer" },
    "rubric_version": { "type": "integer" },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "escalation": {
      "type": "object",
      "additionalProperties": false,
      "required": ["escalation_id", "created_at", "token_path", "reason"],
      "properties": {
        "escalation_id": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" },
        "token_path": {
          "type": "string",
          "description": "人間が開くファイルの絶対パス。トークン値そのものは応答に含めない"
        },
        "reason": { "type": "string" },
        "summary_for_human": {
          "type": "object",
          "additionalProperties": false,
          "required": ["rounds", "weighted_mean_trend", "blocking_criteria"],
          "properties": {
            "rounds": { "type": "integer" },
            "weighted_mean_trend": { "type": "array", "items": { "type": "number" } },
            "blocking_criteria": { "type": "array", "items": { "type": "string" } }
          }
        }
      }
    },
    "next_action": { "type": "object" },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

**エラー条件**

| code | 条件 |
|---|---|
| `E_STATE_VIOLATION` | `FINAL` / `ABORTED` で呼ばれた |
| `E_TOKEN_INVALID` | `human_token` がファイル内の値と不一致、または既に消費済み |
| `E_RESOLUTION_NOT_APPLICABLE` | `ESCALATED` 以外で `action:"resolve"` |
| `E_VALIDATION` | `note` 20文字未満、`resolve` で `resolution`/`human_token` 欠落、`kickback` で `target_criteria` 欠落 |
| `E_UPSTREAM_NOT_FOUND` | `rebase` / `kickback` で上流セッションを解決できない |
| `E_UPSTREAM_DIGEST_MISMATCH` | `rebase` の `upstream_digest` が上流の現在の確定成果物と一致しない |
| `E_CHAIN_BUDGET_EXHAUSTED` | `kickback` がチェーン予算または `chain_max_kickbacks`（2回）を超える |

> **human_token の位置づけ（正直な限界）**: トークンはツール応答には載せず、ファイルにのみ書く。これは「モデルが自分で承認する」事故を防ぐ**速度制限であって、セキュリティ境界ではない**。シェルを持つエージェントは読める。狙いは (a) 承認が明示的な操作になること、(b) 監査 JSON に `token_read_at` と `resolution` が残ること、の2点。

---

#### 6.4.7 `audit_export`

**目的**: 全周回のスコア・根拠・成果物差分を JSON で書き出す。第三者による再検証の入力。

**入力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "include_artifacts": {
      "type": "boolean", "default": false,
      "description": "true で各周の成果物全文を埋め込む。false なら digest とパスのみ"
    },
    "include_rejected": { "type": "boolean", "default": true },
    "include_diffs": { "type": "boolean", "default": true },
    "scope": {
      "enum": ["session", "chain"], "default": "session",
      "description": "chain なら、このセッションが属するチェーン全体（design/plan/implement の全リンク）を audit_version:2 で出す（§19.13.2）"
    }
  }
}
```

**出力スキーマ**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["ok", "session_id", "state", "round", "rubric_version", "persistence", "export", "next_action", "warnings"],
  "properties": {
    "ok": { "const": true },
    "session_id": { "type": "string" },
    "state": { "type": "string" },
    "round": { "type": "integer" },
    "rubric_version": { "type": "integer" },
    "persistence": { "enum": ["durable", "ephemeral"] },
    "export": {
      "type": "object",
      "additionalProperties": false,
      "required": ["path", "bytes", "sha256", "schema", "summary"],
      "properties": {
        "path": { "type": "string" },
        "bytes": { "type": "integer" },
        "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "schema": { "const": "https://agent-plugins.org/x/rubric-loop/v1/audit.json" },
        "summary": {
          "type": "object",
          "additionalProperties": false,
          "required": ["rounds", "final_verdict", "rubric_versions", "relaxations", "rejected_submissions"],
          "properties": {
            "rounds": { "type": "integer" },
            "final_verdict": { "type": "string" },
            "rubric_versions": { "type": "integer" },
            "relaxations": { "type": "integer" },
            "rejected_submissions": { "type": "integer" }
          }
        }
      }
    },
    "next_action": { "type": "object" },
    "warnings": { "type": "array", "items": { "type": "string" } }
  }
}
```

**エラー条件**: `E_SESSION_NOT_FOUND` / `E_VALIDATION`（`scope:"chain"` なのにチェーンを解決できない）/ `E_INTERNAL`（書き込み失敗時は既存ファイルを壊さない）。`persistence:"ephemeral"` の場合は `warnings` に「プロセス終了で消える」を必ず入れる。

---

## 7. 判定・収束・打ち切り

### 7.1 判定アルゴリズム（`score_submit` の中核）

```text
# 入力: submitted[] (criterion_id -> score, evidence), artifact, session
# 既定値: pass_score=9, pass_weighted_mean=9.0, max_rounds=12,
#         stall_window=3, stall_epsilon=0.25, max_score_jump=3

0. 冪等チェック            submission_id が rounds/*/submission_id に既出なら、
                          保存済みの応答（判定を含む）をそのまま返して終了（再適用しない）
1. 状態チェック            state == SCORING でなければ E_STATE_VIOLATION
2. 楽観ロック              expected_round == session.round でなければ E_CONCURRENT
3. digest 束縛             artifact_digest == session.current_artifact.digest でなければ E_DIGEST_MISMATCH
4. 網羅性                  submitted の id 集合 == rubric の id 集合 でなければ E_INCOMPLETE_SCORES
5. 根拠の形式              verification=="auto" の基準に command 根拠が無ければ E_EVIDENCE_KIND
6. 根拠の実在              kind=="locator" の excerpt が成果物本文（正規化後）に無ければ E_EVIDENCE_NOT_FOUND
6.5 前回値の解決        previous_score(c) =
                            - 直前の「受理された」提出に c があればその score
                            - 無ければ null（初回、または rubric_amend で追加された新基準）
                          previous_score == null の基準は 7・8・9 の検査を**スキップ**する
                          （比較対象が存在しないため。この事実は rounds[].submission.scores[].previous_score:null として監査に残る）
7. 根拠の新規性            score > previous_score かつ evidence_digest 集合が前周と完全一致なら E_EVIDENCE_STALE
8. インフレ検出            artifact.unchanged かつ ∃ score > previous_score なら E_SCORE_INFLATION
9. ジャンプ検出            score - previous_score > max_score_jump かつ exit_code==0 の command 根拠 < 2 なら E_SCORE_JUMP
10. 集計                   weighted_mean = Σ(score_i × weight_i) / Σ(weight_i)
                          min_score = min(score_i)
                          improvement = weighted_mean − previous_weighted_mean
11. 停滞カウンタ            improvement < stall_epsilon なら rounds_without_improvement += 1、そうでなければ 0
12. 判定:
    if min_score >= pass_score AND weighted_mean >= pass_weighted_mean:
        if session.relaxation_count > 0 and not session.relaxation_approved:
            verdict = ESCALATED (relaxation_pending_approval)   # F4
        else:
            verdict = FINAL (all_criteria_passed)
    elif session.round >= max_rounds:
        verdict = STALLED (max_rounds_reached)
    elif rounds_without_improvement >= stall_window:
        verdict = STALLED (no_improvement)
    else:
        verdict = ITERATING (min_score < pass_score ? below_pass_score : below_weighted_mean)
13. 永続化 → round += 1（ITERATING のときのみ）→ 応答（must_fix 同梱）
```

### 7.1.1 rubric 版をまたぐときの比較規則

`rubric_amend` で基準集合が変わると、周回間のスコア比較の意味が変わる。曖昧さを残さないため次を規則とする。

| 状況 | `previous_score` | インフレ/ジャンプ/新規性検査 | `weighted_mean` の比較（`improvement`） |
|---|---|---|---|
| 既存基準（id 継続、アンカー変更なし） | 前周の値 | **適用** | そのまま比較 |
| 既存基準（id 継続、アンカーが `stricter` に変更） | 前周の値 | 適用。ただし **`E_SCORE_INFLATION` の対象外**（基準が厳しくなったのに点が上がるのは異常なので、代わりに `warnings` に `stricter_anchor_score_up` を出す） | そのまま比較 |
| 追加された新基準 | `null` | **スキップ** | 追加周の `improvement` は計算するが、**停滞カウンタは 0 にリセット**する（基準集合が変わった直後の比較は前周と等価でないため） |
| 削除された基準 | — | — | 前周の `weighted_mean` を**新しい基準集合で再計算**した値を比較対象にする（削除で自動的に平均が上がるのを防ぐ） |

削除時の再計算があるので、「低い点の基準を消して加重平均を上げる」は `improvement` を生まない。加えて削除は `relaxation` 分類なので `FINAL` も出ない（§5.3）。

### 7.2 既定値と根拠

| パラメータ | 既定 | なぜその値か |
|---|---|---|
| `pass_score` | 9 | 元プロトコルの「全基準9以上」をそのまま機械化 |
| `pass_weighted_mean` | 9.0 | 全基準9なら加重平均も9以上。重み付き平均だけで通る抜け道を作らない（両方を AND） |
| `max_rounds` | 12 | 実測で 8–10 周で収束するタスクが多く、余裕を2–4周持たせた値。超えたら人間を呼ぶ方が安い |
| `stall_window` | 3 | 2 は誤検知（構成の作り直し周は一時的に伸びない）、4 以上は無駄が多い |
| `stall_epsilon` | 0.25 | 10点尺度・重み付き平均で「実質的な前進」と言える最小幅。0.1 未満は誤差、0.5 は前進を止めすぎ。**implement モードのみ 0.20 に下げる**（auto 基準が多く加重平均が階段状に動くため。根拠は §19.10.1） |
| `max_score_jump` | 3 | 5→9 のような一気通貫を禁じ、4→7→9 の2周に分ける。1周1点では収束が遅すぎる |
| `extra_rounds`（escalate continue） | 3 | 人間が「もう少し」と言うときの現実的な追加量 |

上表は `loop_mode:"design"` の値である。`plan` / `implement` はモード別に上書きされる（§19.1 の表と、値ごとの理由）。加えてチェーン全体の上位予算 `chain_max_rounds`（既定28）がある（§19.10.2）。

### 7.3 打ち切りとエスカレーションの出口

```
STALLED になったら、モデルが取れる行動は escalate だけ。
  escalate(action:"request_human")  → ESCALATED、token ファイル生成
  escalate(action:"abort")          → ABORTED（終端）

ESCALATED から戻る道は human_token 必須:
  resolve/continue           → DRAFTING、max_rounds += extra_rounds（既定 +3）、停滞カウンタ 0 クリア
  resolve/accept_as_is       → FINAL_WITH_RELAXATION（閾値未達のまま人間責任で確定。監査に赤旗）
  resolve/approve_relaxation → 緩和承認。次の score_submit が閾値を満たせば FINAL_WITH_RELAXATION
  resolve/abort              → ABORTED
```

**無限ループにも早期終了にもならない根拠**:
- 早期終了しない: `FINAL` はサーバのみが出し、条件は `min_score>=9 AND weighted_mean>=9.0`。モデルの `self_verdict_note` は判定式に一切入らない（F6）。
- 無限にならない: `max_rounds` と `stall_window` の**2系統**で必ず止まる。`max_rounds` の延長は人間の `human_token` を消費する形でしか起きない。

---

## 8. 状態の外部化（永続層）

### 8.1 ディレクトリ構成

すべて `PLUGIN_DATA` 配下。プラグイン更新をまたいで残る。

```
$PLUGIN_DATA/rubric-loop/
├── index.json                       # session_id -> {state, round, updated_at} の一覧、label 逆引き、chain_id 逆引き
├── instance_id                      # OS 起動識別子が無いホストでの boot_id 代用（§8.4）。初回起動時に1度だけ生成
├── chains/<chain_id>/
│   └── chain.json                  # 連鎖の台帳（追記のみ。§19.11.1）
└── sessions/<session_id>/
    ├── session.json                 # 状態機械の現在値（下記 8.3）
    ├── LOCK                         # 排他ロック（pid + boot_id + boot_id_source + acquired_at）
    ├── rubric/
    │   ├── 1.json                   # rubric 全文（版ごと）
    │   └── 2.json
    ├── rubric_diff/
    │   └── 2.json                   # v1→v2 の分類済み差分
    ├── artifacts/
    │   ├── sha256-9ac1….md          # 内容アドレス（同一内容は1ファイル）
    │   └── index.json               # round -> digest の対応
    ├── rounds/
    │   ├── 1.json                   # 受理された提出（スコア+根拠+判定）
    │   ├── 2.json
    │   └── 3.rejected/
    │       ├── 1.json               # 拒否された提出（error_code 付き）
    │       └── 2.json
    ├── escalations/
    │   ├── esc_01.json
    │   └── esc_01.token             # 人間が開くファイル。応答には値を載せない
    ├── exports/
    │   └── audit-20260904T093012Z.json
    ├── rebases/                     # loop_mode が plan/implement のときのみ（§19.3.3）
    │   └── 1.json
    └── test_inventory/              # loop_mode が implement のときのみ（§19.8.2）
        └── 11.json                  # 周ごとのテスト台帳
```

モード別に増えるのは `rebases/` と `test_inventory/` の2つだけで、他は共通である。チェーンの親子関係は `session.json` の `upstream`（子→親の片方向）と `chains/<chain_id>/chain.json`（追記専用の逆引き台帳）で表す。**親を書き換えないことで FINAL 済みセッションの不変性を保つ**（§19.11.1）。

### 8.2 PLUGIN_DATA の解決順序と縮退

```
1. env RUBRIC_LOOP_DATA        （mcp.json で ${PLUGIN_DATA} から注入。第一候補）
2. env CLAUDE_PLUGIN_DATA      （Claude Code のベンダー別名。存在すれば使う）
3. env XDG_STATE_HOME/rubric-loop
4. ~/.local/state/rubric-loop  （Windows は %LOCALAPPDATA%\rubric-loop）
5. どれも書けない → EPHEMERAL モード（プロセス内メモリのみ）
```

- 1 と 2 の**両方が来て値が異なる場合**: 1 を採用し、`warnings` に `data_dir_conflict`（両パスを明記）を出す。理由は Agent Plugins の正準変数を優先し、ベンダー別名を従とするため。
- 3–4 に落ちた場合: `persistence:"durable"` のまま（ディスクには残る）だが `warnings` に `plugin_data_unavailable: fell back to <path>` を出す。プラグイン更新で消える可能性を明示。
- 5（EPHEMERAL）: `loop_open` は `allow_ephemeral:true` が無い限り `E_NO_PERSISTENCE` で拒否。許可された場合も全応答に `persistence:"ephemeral"` と警告が付き、`audit_export` は「プロセス終了で消える」を必ず警告する。

### 8.3 `session.json`（実物）

```json
{
  "schema": "https://agent-plugins.org/x/rubric-loop/v1/session.json",
  "session_id": "rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
  "created_at": "2026-09-04T09:12:33Z",
  "updated_at": "2026-09-04T10:41:02Z",
  "task": "rubric ループで設計を回すための MCP サーバの設計書を作る",
  "artifact_kind": "markdown",
  "state": "DRAFTING",
  "round": 4,
  "rubric_version": 1,
  "rubric_digest": "sha256:5b1e0f9c…",
  "policy": {
    "scale_min": 1, "scale_max": 10,
    "pass_score": 9, "pass_weighted_mean": 9.0,
    "max_rounds": 12, "stall_window": 3, "stall_epsilon": 0.25,
    "max_score_jump": 3, "require_command_evidence_for": ["auto"]
  },
  "current_artifact": {
    "digest": "sha256:9ac1…", "bytes": 48211,
    "committed_at": "2026-09-04T10:40:11Z", "round": 4
  },
  "counters": {
    "rounds_without_improvement": 1,
    "relaxation_count": 0,
    "relaxation_approved": false,
    "rejected_submissions": 2,
    "extra_rounds_granted": 0
  },
  "last_evaluation": {
    "round": 3, "weighted_mean": 8.18, "min_score": 6,
    "verdict": "ITERATING",
    "must_fix": ["acceptance-tests", "self-hosting", "audit"]
  },
  "server": {
    "plugin_root": "/home/u/.agent-plugins/rubric-loop",
    "plugin_root_source": "PLUGIN_ROOT",
    "data_dir": "/home/u/.agent-plugins-data/rubric-loop",
    "data_dir_source": "RUBRIC_LOOP_DATA",
    "persistence": "durable"
  }
}
```

### 8.4 書き込みの原子性と並行性

- 全書き込みは `write(tmp) → fsync(tmp) → rename(tmp, dst) → fsync(dir)`。途中でクラッシュしても **`session.json` は必ず一貫した旧版か新版のどちらか**になる。
- `LOCK` は `O_EXCL` で作成し `{pid, boot_id, boot_id_source, acquired_at}` を書く。同一 `boot_id` で生存していないプロセスのロックは 60 秒後に奪取可（stale lock 回収）。
- **`boot_id` の求め方**（OS 非依存に規定する。`boot_id_source` に採った経路を必ず記録する）:

| 経路 | 取得元 | `boot_id_source` |
|---|---|---|
| OS が起動識別子を持つ | Linux: `/proc/sys/kernel/random/boot_id` を読む | `"os"` |
| OS が起動時刻を持つ | Windows / macOS: 起動時刻（`now - uptime`）を秒精度の ISO 8601 に丸めた文字列を UUIDv5 化する。同一起動中は同値、再起動で必ず別値になる | `"os"` |
| どちらも取れない | `PLUGIN_DATA` 直下の `instance_id`（無ければ起動時に UUIDv4 を生成して原子的に作成、あれば読むだけ）で代用する | `"instance"` |

- 代用時（`boot_id_source:"instance"`）は `instance_id` が再起動をまたいで残るため、**「別の起動で作られた LOCK」を判別できない**。この場合の陳腐化判定は `acquired_at` からの **60 秒経過のみ**に縮退する（pid 生存確認は再起動後に pid が再利用されうるため根拠にしない）。縮退していることは `loop_state` の `warnings` に `"lock_staleness_time_only"` を入れて可視化する（出力スキーマは既存の `warnings: string[]` をそのまま使う。新しいフィールドは足さない）。
- 経路は起動時に1度だけ決め、プロセスの生涯にわたって変えない。`boot_id_source` の異なる LOCK どうしを比較する必要が生じた場合（プラグイン更新をまたいだ等）は、同一 `boot_id` とはみなさず時間のみで判定する。
- 加えて全 mutation ツールは `expected_round` を必須にした**楽観ロック**。ロックが取れても round がずれていれば `E_CONCURRENT`（F12）。
- 成果物は内容アドレスなので、同一内容の再 commit はファイルを増やさず `unchanged:true` を返すだけ。

### 8.5 再開が「モデルの記憶に依存しない」ことの担保

再開に必要な入力は **`session_id` 1個だけ**。`loop_state` が返すもので、ループの継続に必要な情報は全て揃う:

| 継続に必要なもの | どこから来るか |
|---|---|
| 何を作っているか | `task` |
| 基準は何か（全文・アンカー） | `rubric`（版付き） |
| 今何周目か | `round` |
| 今どの状態か・次に何を呼ぶか | `state` + `next_action` |
| 前周のスコアと弱点 | `last_scores` + `must_fix` |
| 直前の成果物はどれか | `current_artifact.digest`（+ 任意で `head`） |
| 打ち切りまであと何周か | `stall.rounds_remaining` |

モデルのコンテキストが完全に空でも、`loop_state(session_id)` 1回で次の一手が確定する。

---

## 9. 可搬パッケージ（実物）

### 9.1 パッケージ構成

```
rubric-loop/
├── plugin.json                     # 固定位置
├── mcp.json                        # 固定位置。既定の transport 宣言（stdio・§9.3）
├── mcp.http.json                   # 任意。streamable-http 版のひな型（§9.4）。この名前ではコンポーネントとして発見されない
├── skills/
│   └── rubric-loop/
│       └── SKILL.md                # 固定位置
├── presets/                        # 仕様の「コンポーネント」ではない付属物
│   ├── design.json                 # モード別 rubric プリセット（§19.7）
│   ├── plan.json
│   └── implement.json
└── server/                         # 仕様の「コンポーネント」ではない付属物
    ├── main.js
    └── package.json
```

`skills/` と `mcp.json` 以外はコンポーネントとして発見されない（`mcp.http.json` も**発見されない**。固定位置の名前は `mcp.json` ただ1つであり、ひな型を同梱しても transport 宣言が2つ有効になることはない）。`server/` は `mcp.json` から `${PLUGIN_ROOT}` 経由で参照されるだけの実装本体であり、`presets/` はサーバが `${PLUGIN_ROOT}` 配下から読む読み取り専用データである。**コンポーネントの種類は増えていない**（skills/ と mcp.json のまま）ので、Agent Plugins 1.0.0 への適合は変わらない。

### 9.2 `plugin.json`（実物）

```json
{
  "$schema": "https://agent-plugins.org/schemas/v1.0.0/plugin.json",
  "name": "rubric-loop",
  "version": "1.0.0",
  "description": "rubric ベースの反復改善ループを、サーバ側の状態と閾値判定で強制する MCP サーバとスキル",
  "license": "MIT"
}
```

- 必須は `$schema` と `name` のみ。`version` / `description` / `license` は closed schema に無ければ**報告のうえ無視**されるだけで非致命（仮定 A6）。機能はこれらに依存しない。
- 資格情報は一切含めない。

### 9.3 `mcp.json`（実物・stdio 既定）

```json
{
  "$schema": "https://agent-plugins.org/schemas/v1.0.0/mcp.json",
  "mcpServers": {
    "rubric-loop": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${PLUGIN_ROOT}/server/main.js",
        "--data-dir",
        "${PLUGIN_DATA}"
      ],
      "env": {
        "RUBRIC_LOOP_ROOT": "${PLUGIN_ROOT}",
        "RUBRIC_LOOP_DATA": "${PLUGIN_DATA}",
        "RUBRIC_LOOP_LOG": "warn"
      },
      "cwd": "${PLUGIN_DATA}"
    }
  }
}
```

**適合性チェック（1行ずつ）**

| 規則 | 本ファイルでの充足 |
|---|---|
| `$schema` が plugin.json と一致 | 両者 `v1.0.0`（`.../schemas/v1.0.0/…`） |
| 最上位キーは `$schema` と `mcpServers` のみ | 他に無し |
| stdio は `type` と `command` が必須 | 両方あり |
| `command` は単一実行トークン | `"node"`（bare name）。空白・パイプ・リダイレクト・引用符を含まない |
| command 内で変数展開しない | `command` に `${…}` を書いていない |
| 変数展開は args / env の値 / cwd のみ | `${PLUGIN_ROOT}` `${PLUGIN_DATA}` は args・env の**値**・cwd だけに出現。env の**キー**は素の文字列 |
| 使える変数は2つだけ | `PLUGIN_ROOT` と `PLUGIN_DATA` のみ。`HOME` や `PATH` 等は展開させない |
| `cwd` は PLUGIN_ROOT / PLUGIN_DATA 配下 | `${PLUGIN_DATA}`（配下そのもの）。`..` を含めない |
| 資格情報を置かない | env は動作パラメータのみ。トークン・鍵は無し |
| legacy SSE 非依存 | `sse` を宣言しない |

**代替（`node` が PATH に無いホスト向け）**: 同じ `mcp.json` の `command` だけを差し替える。

```json
{
  "$schema": "https://agent-plugins.org/schemas/v1.0.0/mcp.json",
  "mcpServers": {
    "rubric-loop": {
      "type": "stdio",
      "command": "./server/bin/rubric-loop",
      "args": ["--data-dir", "${PLUGIN_DATA}"],
      "env": { "RUBRIC_LOOP_ROOT": "${PLUGIN_ROOT}", "RUBRIC_LOOP_DATA": "${PLUGIN_DATA}" },
      "cwd": "${PLUGIN_DATA}"
    }
  }
}
```

`./` 始まりのプラグイン相対パスも単一トークンなので適合。**どちらを採るかはパッケージのビルド構成の選択であり、実行時のフォールバックではない**（フォールバック経路は仕様に無い）。

### 9.4 `mcp.http.json`（streamable-http 版のひな型）

自前でサーバを常駐させる運用向け。**固定位置の `mcp.json` として同時に有効化はできない**（1つのサーバ名に1つの transport 宣言）。そこでファイル名を分け、次のように規定する。

- **既定は `mcp.json`（stdio・§9.3）**。プラグインを展開したままの状態ではこれだけが読まれる。
- streamable-http 版は `mcp.http.json` という**別名でパッケージに同梱する**。この名前は固定位置ではないため、コンポーネントとして発見されず、既定の動作を一切変えない。
- **切り替えは利用者のリネーム操作で行う**：`mcp.json` を退避（例: `mcp.stdio.json`）してから `mcp.http.json` を `mcp.json` にリネームし、クライアントを再起動する。サーバ側にも設計にも transport を選ぶ実行時の分岐は無い（§9.5）。
- リネーム後の `mcp.json` にも §9.3 の適合性チェック表のうち transport 非依存な行（`$schema` 一致、最上位キー、資格情報を置かない、legacy SSE 非依存）がそのまま適用される。

```json
{
  "$schema": "https://agent-plugins.org/schemas/v1.0.0/mcp.json",
  "mcpServers": {
    "rubric-loop": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:8971/mcp"
    }
  }
}
```

- URL は絶対 `http`/`https`、userinfo なし・fragment なし。loopback なので `http` が許される（loopback 以外なら HTTPS 必須）。
- **`headers` を書かない**。1.0.0 に可搬な認証機構が無く、ヘッダはリテラルで資格情報を置けないため。認証が要る配置は loopback バインド + OS のファイル権限で守る運用とし、設計はそこに依存しない。
- URL には変数展開が効かないため、ポートは固定値をベタ書きする。可変にしたい場合は stdio 版を使う。

### 9.5 transport 差への非依存

- 互換クライアントは stdio と streamable-http の**最低1つ**を実装する。本設計はその2つのみを宣言し、legacy SSE を一切使わない → Codex / Hermes / NanoClaw のように SSE 非対応のクライアントでも動作条件が変わらない。
- サーバのツール表面・状態機械・永続層は transport を知らない。transport 依存の分岐はコードにもプロトコルにも無い。
- 宣言 transport で繋がらなかった場合のフォールバックは仕様に無いので、**設計はフォールバックを前提にしない**。接続失敗はコンポーネント障害として §10.3 の縮退に落ちる。

---

## 10. スキルとサーバの責務分割

### 10.1 線引き

| 事項 | スキル（`skills/rubric-loop/SKILL.md`） | サーバ（MCP） |
|---|---|---|
| ループの手順（PLAN/DO/VERIFY/DECIDE） | ○ 定義する | × |
| 何を書くか・どう直すか | ○ 指示する | × |
| rubric の保管・版管理 | × | ○ |
| 周回番号・状態遷移 | × | ○ |
| スコアの受理／拒否 | × | ○ |
| FINAL / ITERATING の決定 | × **名乗ることを禁止** | ○ 独占 |
| 監査記録 | × | ○ |

一文で言えば: **スキルは「回し方」を覚えている。サーバは「回ったかどうか」を決める。**

### 10.2 `skills/rubric-loop/SKILL.md`（実物・3モード対応版）

スキルは**1本**にする（3本に割らない理由は §19.12.1）。モードの選択と遷移はサーバの `next_action` と `loop_mode` が決めるので、スキル側はモードごとに分岐する必要がない。

```markdown
---
name: rubric-loop
description: 設計・実装計画・実装を、サーバ側の rubric 判定で合格するまで回す。設計書を書く / 実装計画を立てる / 計画どおり実装する、のいずれかを頼まれたときに使う。
---

## 原則

合格・不合格を決めるのは**あなたではなくサーバ**である。あなたの仕事は、成果物を出し、
根拠つきで自己採点し、サーバが返す `must_fix` を潰すこと。自分で「もう十分だ」と判断しない。

## モードの選び方

| 頼まれたこと | `loop_mode` | 上流 |
|---|---|---|
| 要求から設計書を作る | `design` | 不要 |
| 確定した設計書から実装計画を作る | `plan` | 設計セッションのハンドルと成果物ダイジェスト |
| 確定した計画からコードとテストを書く | `implement` | 計画セッションのハンドルと成果物ダイジェスト |

上流のダイジェストが分からなければ、上流セッションで `loop_state` を呼んで取る。
推測で埋めない（間違っていればサーバが `E_UPSTREAM_DIGEST_MISMATCH` で拒否する）。

## 手順

1. `loop_open` を呼ぶ。新規なら `mode:"create"` + `loop_mode` + `task` + `rubric_preset`、
   再開なら `mode:"resume"` + `session_id`。`submission_id` は毎回ユニークな文字列を作って渡す。
2. 返ってきた `next_action` に従う。以後この繰り返し。
3. `artifact_commit` — **毎回、成果物の全文**を出す（差分ではない）。
   `expected_round` はサーバが返した `round` をそのまま入れる。
   `addresses` には、前回の `must_fix` の先頭にある基準 id を必ず含める。
   - `loop_mode:"implement"` では `content` ではなく `files` + `manifest_command` +
     `manifest_output_sha256` + `test_inventory` を渡す。
     テストファイルを変更したなら、そのファイルの差分を `test_inventory.diffs` に入れる。
4. `score_submit` — 全基準に点数・理由（40文字以上）・弱点・根拠を付ける。
   甘く付けても得はない。サーバは前回との差と根拠を見ており、
   根拠のない上昇は `E_SCORE_INFLATION` で拒否される。
   - 上流の記述に対応させた点は `kind:"upstream"` の根拠で示す。
   - `implement` ではコマンド根拠に `target_digest`（直前の `artifact_commit` が返した digest）を必ず入れる。
5. `verdict` が `PASS` なら終わり。`REVISE` なら `must_fix` を潰して 3 に戻る。

## 上流が変わったと言われたら

`state` が `SUPERSEDED` になったら、`loop_state{include:["upstream"]}` で新しい上流を読み、
`escalate{action:"rebase", upstream_digest:<current>}` を呼ぶ。
サーバが「どの基準を採点し直す必要があるか」を返すので、それだけを直す。全部やり直さない。

## 上流が間違っていると気づいたら

下流で辻褄を合わせない。`escalate{action:"kickback", target_criteria:[…], note:"欠陥の説明"}` を
提案し、人間の承認トークンを求める。あなたのセッションは凍結され、上流が直ってから再開する。

## 文脈を失ったとき

`session_id` だけを頼りに `loop_open{mode:"resume"}` → `loop_state{include:["rubric","must_fix","upstream","last_artifact"]}`。
必要な情報は全部返ってくる。思い出そうとしない。

## ツールが使えないとき（縮退）

MCP サーバが起動していない場合は、以下を守った上で作業し、成果物の冒頭に必ず
`UNVERIFIED-COMPLETE: rubric-loop server unavailable` と書く。

- `design` — rubric の各基準を文書内に列挙し、自己採点表（点数・理由・弱点）を成果物の末尾に付ける。
  合格を主張しない。
- `plan` — 同上に加えて、タスクの依存が循環していないことを自分でトポロジカルソートして示す。
  `design_refs` は手で設計書の見出しと照合する。
- `implement` — 同上に加えて、テストの実行結果（コマンド・終了コード・件数）を必ず貼る。
  **この成果物をマージ・デプロイしてよいとは主張しない**。人間のレビューを明示的に求める。
```

### 10.3 サーバ障害時の振る舞い（縮退の定義）

Agent Plugins ではコンポーネント個別の失敗は非致命なので、**MCP サーバが起動しなくても `skills/` はロードされる**。そのときの挙動を「縮退動作」として決め切る。

| 事象 | 検出 | 振る舞い |
|---|---|---|
| サーバが起動しない（ツールが一覧に無い） | モデルが `loop_open` を呼べない | スキルの縮退規約に入る。ループは回すが `FINAL` を名乗らず `UNVERIFIED-COMPLETE`。fallback journal をワークスペースに残す |
| 周回中にサーバが落ちた（ツール呼び出しが失敗） | ツールエラー | その周は**採点無効**。復帰後 `loop_state` で `round` を確認し、同じ周をやり直す。`session.json` は原子的書き込みなので中途半端な周は残らない |
| `PLUGIN_DATA` に書けない | 起動時の解決失敗 | §8.2 の 3–5 に縮退。EPHEMERAL なら `loop_open` を明示拒否し、`allow_ephemeral:true` を要求（黙って揮発しない） |
| ロックが取れない | `LOCK` 競合 | `E_CONCURRENT` を返して**明示的に停止**。勝手に奪わない（stale 判定時のみ 60 秒後に奪取） |

方針は一貫している: **判定に関わる縮退は「明示的な格下げ or 停止」。判定に関わらない縮退（保存先の劣化）は警告付きで継続。** 黙って弱い保証に落ちる経路を作らない。

---

## 11. ホスト差の吸収

### 11.1 `PLUGIN_ROOT` の解決順序

Claude Code は互換クライアント一覧に無く独自のプラグイン形式を持つ。`${CLAUDE_PLUGIN_ROOT}` は **`PLUGIN_ROOT` のベンダー別名**として扱い、解決順序を決め切る。

```
1. env RUBRIC_LOOP_ROOT     （Agent Plugins 準拠ホストが ${PLUGIN_ROOT} から注入した値）
2. env CLAUDE_PLUGIN_ROOT   （Claude Code のベンダー別名）
3. env PLUGIN_ROOT          （ホストが素の名前で渡した場合。仕様は要求していないが害が無いので拾う）
4. サーバ実行ファイルの位置から導出（server/main.js の親の親 = パッケージルート）
5. 解決不能 → 起動は続行。プリセット rubric の読み込みのみ無効化し warnings に root_unresolved
```

| 状況 | 挙動 |
|---|---|
| 1 と 2 の両方が来て**同値** | そのまま採用。警告なし |
| 1 と 2 の両方が来て**異値** | **1 を採用**（Agent Plugins の正準変数が優先。ベンダー別名は従）。`warnings` に `root_conflict: RUBRIC_LOOP_ROOT=<a> CLAUDE_PLUGIN_ROOT=<b> using=<a>` を出し、`session.json.server.plugin_root_source` に `"PLUGIN_ROOT"` を記録 |
| どちらも来ない | 3 → 4 の順に落ちる。4 で解決した場合 `plugin_root_source:"argv0"` を記録し警告 |
| 4 も失敗 | 5。**判定・状態・監査には影響しない**（PLUGIN_ROOT はプリセット rubric の読み込みにしか使わないため）。ループは通常どおり回る |

`PLUGIN_DATA` 側の解決順序は §8.2。**役割の非対称性が重要**: `PLUGIN_ROOT` が無くてもループは回る（プリセットが読めないだけ）。`PLUGIN_DATA` が無いと状態が持てないので、そちらだけが明示拒否の対象になる。

### 11.2 ベンダー固有前提を持ち込まない境界

| 事項 | 本設計の扱い |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}` を `mcp.json` に書く | **書かない**。`mcp.json` は `PLUGIN_ROOT` / `PLUGIN_DATA` のみ。別名の吸収は**サーバ内の env 解決**で行う |
| Claude Code のネイティブ形式（`.claude-plugin/` 等） | 同じ `server/` を指す別マニフェストを**別リポジトリ成果物として**用意してよいが、Agent Plugins パッケージ側はそれを参照しない。両者は独立に完結する |
| ホスト固有のフック・スラッシュコマンド・サブエージェント | 使わない。コンポーネントは `skills/` と `mcp.json` の2種のみ |
| MCP の `outputSchema` / `structuredContent` 対応差 | 仮定 A5。structured と同内容の JSON テキストを二重に返し、どちらか一方しか読まないホストでも情報が落ちない |
| ツール一覧の並び順・命名慣習 | 依存しない。スキルはツールを**名前で**呼ぶ |

### 11.3 transport 差

§9.5 のとおり legacy SSE に依存しない。互換クライアントは stdio か streamable-http の最低1つを実装するため、本パッケージはどの互換クライアントでも「宣言した transport がそのまま使える」状態になる。フォールバック経路は仕様に無いので設計しない（接続失敗は §10.3 の縮退）。

---

## 12. 監査可能性

### 12.1 監査 JSON のスキーマ（要点）

`audit_export` が書き出すファイルは `https://agent-plugins.org/x/rubric-loop/v1/audit.json` に従う。第三者が「本当に基準を満たしたか」を再検証できる情報のみで構成する。

| セクション | 内容 |
|---|---|
| `session` | id / task / 状態 / 最終判定 / タイムスタンプ / サーバの解決情報 |
| `rubric_versions[]` | 版ごとの全文 + digest + 変更理由 + 分類（`addition` / `relaxation` …） |
| `rounds[]` | 周ごとの成果物 digest・差分統計・変更メモ・全基準のスコア・根拠・弱点・サーバ判定 |
| `rejected_submissions[]` | 拒否された提出とエラーコード（**ごまかしの試行が残る**） |
| `escalations[]` | エスカレーションと人間の解決内容 |
| `verification_recipe` | 監査者が再検証するための手順（下記 12.3） |

### 12.2 出力実例（1セッション分・抜粋なしの完全形）

```json
{
  "schema": "https://agent-plugins.org/x/rubric-loop/v1/audit.json",
  "exported_at": "2026-09-04T11:02:44Z",
  "session": {
    "session_id": "rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
    "task": "rubric ループで設計を回すための MCP サーバの設計書を作る",
    "artifact_kind": "markdown",
    "created_at": "2026-09-04T09:12:33Z",
    "final_state": "FINAL",
    "final_verdict": "FINAL",
    "final_verdict_reason": "all_criteria_passed",
    "rounds": 3,
    "policy": {
      "pass_score": 9, "pass_weighted_mean": 9.0, "max_rounds": 12,
      "stall_window": 3, "stall_epsilon": 0.25, "max_score_jump": 3,
      "require_command_evidence_for": ["auto"]
    },
    "server": {
      "plugin_root": "/home/u/.agent-plugins/rubric-loop",
      "plugin_root_source": "PLUGIN_ROOT",
      "data_dir": "/home/u/.agent-plugins-data/rubric-loop",
      "data_dir_source": "RUBRIC_LOOP_DATA",
      "persistence": "durable",
      "server_version": "1.0.0"
    }
  },
  "rubric_versions": [
    {
      "version": 1,
      "digest": "sha256:5b1e0f9c2d7a4b118e63c0a95f2d1e8477ac30bb914d6e5f2a70c8d31be49f06",
      "created_at": "2026-09-04T09:12:33Z",
      "classification": "initial",
      "reason": "初版",
      "criteria": [
        {
          "id": "package-conformance",
          "title": "可搬パッケージ準拠",
          "description": "plugin.json / mcp.json が Agent Plugins 1.0.0 に適合する",
          "weight": 3,
          "anchors": {
            "1": "実物が無い、または $schema が両者で食い違う",
            "5": "実物はあるが command にシェル文字列や変数展開を含む",
            "9": "両者の $schema が一致し、command は単一実行トークン、変数は PLUGIN_ROOT/PLUGIN_DATA のみ、cwd が両ディレクトリ配下、ヘッダに資格情報が無い"
          },
          "verification": "auto",
          "verify_hint": "jq で $schema 一致と command の単一トークン性を検査する"
        }
      ]
    }
  ],
  "rounds": [
    {
      "round": 3,
      "state_at_scoring": "SCORING",
      "artifact": {
        "digest": "sha256:9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4",
        "bytes": 48211,
        "path": "artifacts/sha256-9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4.md",
        "previous_digest": "sha256:41b7c9e2a05d38f6712e9c4b0a8d57312fc6e0b94a2d7185cf3e60d29ab41752",
        "change_note": "受け入れテストを9本に増やし、監査 JSON の完全な実例と再検証手順を追加した",
        "addresses": ["acceptance-tests", "audit"],
        "diff": { "added_lines": 412, "removed_lines": 37, "changed_ratio": 0.31 },
        "committed_at": "2026-09-04T10:40:11Z"
      },
      "submission": {
        "submitted_at": "2026-09-04T10:52:07Z",
        "self_verdict_note": "全部通ったと思う",
        "scores": [
          {
            "criterion_id": "package-conformance",
            "score": 9,
            "previous_score": 7,
            "passed": true,
            "rationale": "9点アンカーの4条件（$schema 一致 / 単一トークン command / 許可変数のみ / 資格情報なし）を jq で機械検査し、全て真を確認した",
            "weakness": "streamable-http 版のポート固定という制約が運用上の不便として残る",
            "evidence": [
              {
                "kind": "command",
                "command": "jq -r '.\"$schema\"' plugin.json mcp.json | uniq | wc -l",
                "exit_code": 0,
                "output_excerpt": "1\n",
                "output_sha256": "b6d81b36a8a4d0dcbcd0d9d18b1b1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b",
                "evidence_digest": "sha256:c19f4a7b2e0d8351c6a94f7b0e2d5183ac47f0b91d6e2c358a4f70b1d9e26c85"
              },
              {
                "kind": "command",
                "command": "jq -e '[.mcpServers[].command] | all(test(\"^(\\\\./)?[A-Za-z0-9._/-]+$\") and (contains(\" \") | not))' mcp.json",
                "exit_code": 0,
                "output_excerpt": "true\n",
                "output_sha256": "3a1f5c7e9b0d2468ace13579bdf02468ace13579bdf02468ace13579bdf02468",
                "evidence_digest": "sha256:7e2b95c04f1a63d8259b07e4c1f6a3d0b85e27f9c04a13d6e8b52f70a9c1d436"
              },
              {
                "kind": "locator",
                "locator": "§9.3 適合性チェック表",
                "excerpt": "変数展開は args / env の値 / cwd のみ",
                "evidence_digest": "sha256:f0c31d85a29e7b46013c5f82d7a09e61b4c82f57d0a93e16b7c40f28d5a91e63"
              }
            ]
          }
        ]
      },
      "evaluation": {
        "weighted_mean": 9.24,
        "min_score": 9,
        "passed_count": 15,
        "total_count": 15,
        "improvement": 1.06,
        "rounds_without_improvement": 0,
        "verdict": "FINAL",
        "verdict_reason": "all_criteria_passed",
        "decided_by": "server",
        "decided_at": "2026-09-04T10:52:07Z"
      }
    }
  ],
  "rejected_submissions": [
    {
      "round": 2,
      "attempt": 1,
      "submitted_at": "2026-09-04T10:11:52Z",
      "error_code": "E_SCORE_INFLATION",
      "detail": {
        "artifact_digest": "sha256:41b7c9e2a05d38f6712e9c4b0a8d57312fc6e0b94a2d7185cf3e60d29ab41752",
        "unchanged": true,
        "inflated": [
          { "criterion_id": "acceptance-tests", "from": 6, "to": 9 },
          { "criterion_id": "audit", "from": 7, "to": 9 }
        ]
      }
    },
    {
      "round": 2,
      "attempt": 2,
      "submitted_at": "2026-09-04T10:19:03Z",
      "error_code": "E_EVIDENCE_NOT_FOUND",
      "detail": {
        "criterion_id": "self-hosting",
        "excerpt_head": "本設計書自身を9周かけて収束させた記録は付録Zに"
      }
    }
  ],
  "escalations": [],
  "verification_recipe": {
    "artifact_hash_algo": "sha256",
    "normalization": "UTF-8 NFC / CRLF→LF / 末尾空白除去 / 末尾改行1個に正規化",
    "steps": [
      "各 rounds[].artifact.path のファイルを正規化して sha256 を取り、artifact.digest と一致することを確認する",
      "kind:'command' の evidence を再実行し、exit_code と出力の sha256 が記録と一致することを確認する",
      "kind:'locator' の evidence の excerpt が、その周の成果物本文に正規化後に存在することを確認する",
      "rubric_versions[] の classification に 'relaxation' があれば、escalations[] に対応する承認があるか確認する",
      "最終周の per_criterion.score が全て policy.pass_score 以上で、weighted_mean が policy.pass_weighted_mean 以上であることを再計算する",
      "rejected_submissions[] を読み、ごまかしの試行がどの機構で止まったかを確認する"
    ]
  }
}
```

### 12.3 第三者による再検証が成立する理由

- 成果物は**内容アドレスで保存**されているので、後から差し替えると digest が合わなくなる。
- `command` 根拠は**再実行可能な文字列 + 出力ハッシュ**で残るので、監査者が同じコマンドを回して照合できる（サーバ自身は実行しない・仮定 A4）。
- `locator` 根拠は**その周の成果物本文**に対して照合できる（サーバが受理時に検証済みだが、監査者も再検証できる）。
- 判定は `decided_by:"server"` と閾値の記録付きなので、**式を手で再計算できる**。
- `rejected_submissions[]` があるので、「ごまかそうとしたが止められた」履歴まで見える。ここが空でないセッションは、むしろ機構が働いた証拠になる。

---

## 13. 受け入れテスト

各シナリオは「呼ぶツール列 → 期待される返り値」まで書く。`S` はセッション id、応答は要点のみ抜粋。

AT-1〜AT-9 は単一モード（`loop_mode:"design"` 相当）のループ、AT-10〜AT-18 は3モード連鎖のシナリオである。見出しは全件 `### AT-<番号>: <一行の目的>` の一形式に統一してあり、**1つの AT が1本のテストに対応する**（合計18本）。機械照合はこの1規則だけで足りる。

### AT-1: 正常収束

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | `loop_open{mode:"create", label:"rubric-loop-design", task, rubric(15基準)}` | `ok:true`, `handle_minted:true`, `session_id:"rl_01J…"`（**サーバ発行**。以後 `S` と呼ぶ）, `state:"DRAFTING"`, `round:1`, `rubric_version:1`, `next_action.tool:"artifact_commit"` |
| 2 | `artifact_commit{S, expected_round:1, content:<初版>, change_note:"初版"}` | `state:"SCORING"`, `artifact.digest:"sha256:41b7…"`, `artifact.unchanged:false`, `next_action.tool:"score_submit"` |
| 3 | `score_submit{S, 1, "sha256:41b7…", scores(15件, 最低6)}` | `verdict:"ITERATING"`, `verdict_reason:"below_pass_score"`, `evaluation.min_score:6`, `must_fix[0].criterion_id:"acceptance-tests"`, `round:2`, `state:"DRAFTING"` |
| 4 | `artifact_commit{S, 2, <改稿>, change_note:"受け入れテストを9本に", addresses:["acceptance-tests"]}` | `state:"SCORING"`, `artifact.unchanged:false`, `diff.added_lines>0` |
| 5 | `score_submit{S, 2, <新digest>, scores(最低8)}` | `verdict:"ITERATING"`, `improvement:0.9`, `must_fix[0].criterion_id:"self-hosting"`, `round:3` |
| 6 | `artifact_commit{S, 3, <改稿>, addresses:["self-hosting"]}` → `score_submit{S, 3, …, 全9以上}` | `verdict:"FINAL"`, `verdict_reason:"all_criteria_passed"`, `weighted_mean:9.24`, `state:"FINAL"`, `next_action.tool:"audit_export"` |
| 7 | `artifact_commit{S, 3, …}`（FINAL 後の追記を試す） | `E_STATE_VIOLATION`, `expected_tools:["loop_state","audit_export"]` |
| 8 | `audit_export{S}` | `export.path:".../exports/audit-…json"`, `summary.final_verdict:"FINAL"`, `summary.rejected_submissions:0` |

### AT-2: ごまかし検出①：成果物不変でスコアだけ上昇

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | （AT-1 の 3 の直後、`round:2`）`artifact_commit{S, 2, content:<round1 と同一本文>, change_note:"表現を見直したが結論は同じ"}` | `ok:true`, `artifact.unchanged:true`, `artifact.previous_digest == artifact.digest`, `warnings:["この周でスコアを上げる提出は拒否される"]` |
| 2 | `score_submit{S, 2, <同digest>, scores(acceptance-tests を 6→9)}` | **`E_SCORE_INFLATION`**, `detail.inflated:[{criterion_id:"acceptance-tests", from:6, to:9}]`, `state` は `SCORING` のまま, `round` は 2 のまま |
| 3 | `score_submit{S, 2, <同digest>, scores(全て前周と同点)}` | `ok:true`, `verdict:"ITERATING"`, `improvement:0.0`, `stall.rounds_without_improvement:1` |
| 4 | `audit_export{S}` | `rejected_submissions[0].error_code:"E_SCORE_INFLATION"` |

### AT-3: ごまかし検出②：根拠の捏造と使い回し

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | `artifact_commit{S, 3, <改稿>, addresses:["self-hosting"]}` | `state:"SCORING"`, 新 digest |
| 2 | `score_submit{…, scores: self-hosting=9, evidence:[{kind:"locator", locator:"付録Z", excerpt:"本設計書自身を9周かけて収束させた記録は付録Zに"}]}`（本文に存在しない） | **`E_EVIDENCE_NOT_FOUND`**, `detail.criterion_id:"self-hosting"`, `detail.excerpt_head:"本設計書自身を9周かけて…"` |
| 3 | `score_submit{…, scores: self-hosting=9, evidence:[前周と同一の locator 1件のみ]}` | **`E_EVIDENCE_STALE`**, `detail.duplicate_evidence_digests:["sha256:f0c3…"]` |
| 4 | `score_submit{…, package-conformance=9, evidence:[{kind:"locator", …}] のみ}`（当該基準は `verification:"auto"`） | **`E_EVIDENCE_KIND`**, `detail.criterion_id:"package-conformance"`, `detail.required:"command"` |
| 5 | `score_submit{…, acceptance-tests: 4→9（delta 5）, evidence:[command 1件]}` | **`E_SCORE_JUMP`**, `detail.delta:5`, `detail.max_score_jump:3`, `detail.required:"exit_code:0 の command 根拠 2件以上"` |
| 6 | `score_submit{…, 正しい根拠一式}` | `ok:true`, `verdict:"ITERATING"` または `"FINAL"` |

### AT-4: 停滞打ち切り

前提: `stall_window:3`, `stall_epsilon:0.25`。round 4 時点の `weighted_mean:8.10`。

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | round 5: `artifact_commit` → `score_submit`（`weighted_mean:8.20`, improvement 0.10） | `verdict:"ITERATING"`, `stall.rounds_without_improvement:1`, `stall.rounds_remaining:7` |
| 2 | round 6: 同様（`8.28`, improvement 0.08） | `verdict:"ITERATING"`, `stall.rounds_without_improvement:2` |
| 3 | round 7: 同様（`8.35`, improvement 0.07） | **`verdict:"STALLED"`**, `verdict_reason:"no_improvement"`, `state:"STALLED"`, `next_action.tool:"escalate"`, `round` は 7 のまま |
| 4 | `artifact_commit{S, 7, …}` | `E_STATE_VIOLATION`, `expected_tools:["loop_state","escalate","audit_export"]` |
| 5 | `escalate{S, action:"request_human", note:"3周スコアが動かない。基準 self-hosting の解釈で詰まっている"}`（MRTR 対応クライアントなら `resultType:"input_required"` が返り、人間の回答を付けた再試行で解決する。以下は非対応クライアントの経路） | `state:"ESCALATED"`, `escalation.token_path:".../escalations/esc_01.token"`, `escalation.summary_for_human.weighted_mean_trend:[8.10,8.20,8.28,8.35]`, `blocking_criteria:["self-hosting","audit"]`。**トークン値は応答に含まれない** |
| 6 | `escalate{S, action:"resolve", resolution:"continue", human_token:"<誤った値>", note:"続行"}` | **`E_TOKEN_INVALID`**, `state:"ESCALATED"` のまま |
| 7 | `escalate{S, action:"resolve", resolution:"continue", human_token:"<ファイルの値>", extra_rounds:3, note:"self-hosting の解釈を人間が指定した。続行してよい"}` | `state:"DRAFTING"`, `round:8`, `policy 実効 max_rounds:15`, `stall.rounds_without_improvement:0`, トークンは消費済み（再利用は `E_TOKEN_INVALID`） |

### AT-5: max_rounds 到達

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | round 12 の `score_submit`（まだ `min_score:8`） | **`verdict:"STALLED"`**, `verdict_reason:"max_rounds_reached"`, `state:"STALLED"` |
| 2 | `escalate{S, action:"abort", note:"要件自体を見直すため中断する"}` | `state:"ABORTED"`（終端）, `next_action.tool:"audit_export"` |
| 3 | `escalate{S, action:"request_human", note:"やっぱり続けたい"}` | `E_STATE_VIOLATION`（`ABORTED` は終端） |

### AT-6: セッション再開

前提: round 5 の `DRAFTING` 状態でホストを再起動。モデルのコンテキストは空。

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | `loop_open{mode:"resume", session_id:S}`（`task`/`rubric` を渡さない。ハンドルを失っていれば `label:"rubric-loop-design"` でも引ける） | `ok:true`, `resumed:true`, `state:"DRAFTING"`, `round:5`, `rubric_version:1`, `rubric` 全文, `history` 4件, `next_action.tool:"artifact_commit"` |
| 2 | `loop_state{S, include:["rubric","must_fix","last_scores","artifact_head"], artifact_head_bytes:2000}` | `must_fix[0]:{criterion_id:"self-hosting", score:6, gap:3, anchor_9:"…", verify_hint:"…", last_weakness_note:"トレースが3周分しかない"}`, `current_artifact.digest:"sha256:…"`, `current_artifact.head:"# rubric ループ実行 MCP サーバ 設計書…"` |
| 3 | `loop_open{S, mode:"resume", rubric:{…}}` | **`E_RUBRIC_ON_RESUME`**（再開時に基準を差し替える経路は無い） |
| 4 | `artifact_commit{S, expected_round:4, …}`（古い周番号） | **`E_CONCURRENT`**, `detail.server_round:5` |
| 5 | `artifact_commit{S, submission_id:"a5-1", expected_round:5, …, addresses:["self-hosting"]}` | `ok:true`, `state:"SCORING"` |
| 6 | 同一呼び出しを再送 `artifact_commit{S, submission_id:"a5-1", …}`（ストリーム断を想定） | `ok:true`, **5 と完全に同じ応答**（同 digest・同 round）。二重登録なし |
| 7 | `score_submit{S, submission_id:"s5-1", …}` → 応答が届かず再送 `score_submit{S, submission_id:"s5-1", …}` | 2回目も**1回目と同じ `verdict` と同じ `round`** を返す。周回は1つしか進まない |
| 8 | `loop_open{mode:"create", session_id:"rl_01J…", task, rubric}` | **`E_HANDLE_NOT_ACCEPTED`**（ハンドルはサーバが発行する） |

### AT-7: rubric の緩和を検出してエスカレーション

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | `rubric_amend{S, expected_round:6, criteria:<self-hosting を削除した13件>, reason:"self-hosting は本設計の範囲では過剰なので外す", acknowledge_relaxation:false}` | **`E_RELAXATION_UNACKNOWLEDGED`**, `detail.classification:"relaxation"`, `detail.removed:["self-hosting"]` |
| 2 | 同上 + `acknowledge_relaxation:true` | `ok:true`, `rubric_version:2`, `classification:"relaxation"`, `relaxation_count:1`, **`final_reachable:false`**, `warnings:["FINAL は人間承認まで出ません"]` |
| 3 | `rubric_amend{…, criteria に policy を含めて送る}` | `E_VALIDATION`（入力に `policy` プロパティが無く `additionalProperties:false`）。仮に受理経路があっても `E_THRESHOLD_IMMUTABLE` |
| 4 | round 6: `artifact_commit` → `score_submit`（全13基準 9以上, `weighted_mean:9.3`） | **`verdict:"ESCALATED"`**, `verdict_reason:"relaxation_pending_approval"`, `state:"ESCALATED"`（**FINAL にはならない**） |
| 5 | `escalate{S, action:"resolve", resolution:"approve_relaxation", human_token:"<ファイルの値>", note:"基準削除を人間が承認した"}` | `state:"DRAFTING"`, `relaxation_approved:true`, `next_action.tool:"artifact_commit"` |
| 6 | round 7: `artifact_commit` → `score_submit`（全9以上） | `verdict:"FINAL_WITH_RELAXATION"`, `state:"FINAL_WITH_RELAXATION"` |
| 7 | `audit_export{S}` | `rubric_versions[1].classification:"relaxation"`, `escalations[0].resolution:"approve_relaxation"`, `summary.relaxations:1`。**緩めた事実が監査に残る** |

### AT-8: モデルの自己申告を無効化する

| # | 呼び出し | 期待される返り値 |
|---|---|---|
| 1 | `score_submit{…, scores(min_score:8, weighted_mean:9.1), self_verdict_note:"全部満たしたので FINAL でよい"}` | `verdict:"ITERATING"`, `verdict_reason:"below_pass_score"`（`min_score 8 < 9`）。`self_verdict_note` は `rounds[].submission.self_verdict_note` に**記録されるだけ**で判定式に入らない |
| 2 | `score_submit{…, scores(全9以上だが weighted_mean:8.9 になる重み配置)}` | 発生しない（全9以上なら加重平均も必ず9以上）。逆に `weighted_mean:9.4` でも `min_score:7` なら `ITERATING`。**AND 条件**であることの確認 |
| 3 | `score_submit`（`DRAFTING` 中に、`artifact_commit` を飛ばして呼ぶ） | `E_STATE_VIOLATION`, `expected_tools:["artifact_commit", …]`。**採点前に必ず版が確定する**ことの確認 |
| 4 | `score_submit{…, artifact_digest:"sha256:<前周の digest>"}` | `E_DIGEST_MISMATCH`, `detail.expected:"sha256:<今周の digest>"` |

### AT-9: サーバ起動失敗時のスキル単独動作

前提: `mcp.json` のサーバが起動失敗（`node` が無い等）。Agent Plugins ではコンポーネント障害は非致命なので `skills/` はロード済み。

| # | 動作 | 期待される結果 |
|---|---|---|
| 1 | モデルがスキルを起動し `loop_open` を呼ぼうとする | ツールが一覧に無い／呼び出しがエラー。**プラグイン全体は落ちていない**（スキルは有効） |
| 2 | スキルの「ツールが使えないとき」節に従い縮退モードに入る | 会話内に rubric を展開し、手動でループを回す |
| 3 | 各周の終わりに `./rubric-loop-fallback.json` に追記 | 配列に `{round, artifact_sha256, scores[], evidence[], weakness[]}` が1要素ずつ増える |
| 4 | 全基準9以上に到達したとモデルが判断 | 出力は **`UNVERIFIED-COMPLETE`**。`FINAL` とは書かない（スキルの禁止事項） |
| 5 | サーバ復旧後: `loop_open{S, mode:"create", task, rubric}` → fallback の各周を `artifact_commit` + `score_submit` で順に再投入 | 各周がサーバの検査（digest / 根拠 / ジャンプ）を通り、最終周でサーバが `verdict` を出す。ここで初めて `FINAL` が出る |
| 6 | 再投入で `E_SCORE_INFLATION` 等が出た場合 | その周は拒否され `ITERATING` のまま。**手動ループの甘さが事後に検出される**（縮退が検証の抜け穴にならない） |


### AT-10: 3モード連鎖の正常系

```
1. loop_open{mode:"create", submission_id:"a", loop_mode:"design",
             task:"…", rubric_preset:"design", label:"X-design"}
   → {session_id:"rl_…AAA", chain_id:"ch_…", loop_mode:"design",
      state:"DRAFTING", round:1, artifact_kind:"markdown", next_action:"artifact_commit"}

2. artifact_commit{…} → score_submit{…} を繰り返し、5周目で
   → {verdict:"PASS", state:"FINAL",
      artifact_digest:"sha256:9ac1…", weighted_mean:9.2}

3. loop_open{mode:"create", submission_id:"b", loop_mode:"plan",
             upstream:{session_id:"rl_…AAA", artifact_digest:"sha256:9ac1…"},
             task:"…", rubric_preset:"plan"}
   → {session_id:"rl_…BBB", chain_id:"ch_…"  ← 同じチェーン,
      loop_mode:"plan", artifact_kind:"plan", state:"DRAFTING", round:1,
      upstream:{…, verdict:"FINAL", drift:false}}

4. loop_state{session_id:"rl_…BBB", include:["upstream"]}
   → {upstream_artifact:{digest:"sha256:9ac1…", content:"# rubric ループ…（設計書全文）"}}

5. artifact_commit{session_id:"rl_…BBB", content:"<計画JSON>", …}
   → {accepted:true, artifact:{digest:"sha256:4d2b…"},
      plan_checks:{tasks:12, toposort:"ok", design_refs_verified:12}}

6. score_submit{…} → {verdict:"PASS", state:"FINAL"}

7. loop_open{mode:"create", submission_id:"c", loop_mode:"implement",
             upstream:{session_id:"rl_…BBB", artifact_digest:"sha256:4d2b…"},
             task:"…", rubric_preset:"implement"}
   → {session_id:"rl_…CCC", artifact_kind:"fileset", chain_id:"ch_…"}

8. audit_export{session_id:"rl_…CCC", scope:"chain"}
   → sessions が3件、links が2件、links[i].verified が全て true
```

**期待**: `chain_id` が3セッションで同一。`links` の digest が上流の `final.artifact_digest` と一致。

### AT-11: 上流の版を知らずに下流を開こうとする

```
loop_open{mode:"create", submission_id:"d", loop_mode:"plan",
          upstream:{session_id:"rl_…AAA",
                    artifact_digest:"sha256:0000000000000000000000000000000000000000000000000000000000000000"},
          task:"…", rubric_preset:"plan"}
→ {error:{code:"E_UPSTREAM_DIGEST_MISMATCH",
          detail:{expected:"sha256:9ac1…", actual:"sha256:0000…"}}}
   セッションは作られない（index.json に増えない）

loop_open{mode:"create", submission_id:"e", loop_mode:"plan", task:"…", rubric_preset:"plan"}
→ {error:{code:"E_VALIDATION", detail:{reason:"upstream is required for loop_mode plan"}}}
   （スキーマ段階で弾かれるため E_UPSTREAM_REQUIRED に到達しないことも可。どちらでも受理はされない）

loop_open{mode:"create", submission_id:"f", loop_mode:"design",
          upstream:{…}, task:"…", rubric_preset:"design"}
→ {error:{code:"E_UPSTREAM_NOT_ALLOWED"}}
```

**期待**: 上流の digest を知らないと下流が開けない。design には上流を付けられない。

### AT-12: 上流変更による下流の失効と部分再検証

```
前提: rl_…BBB(plan) が FINAL、rl_…CCC(implement) が round 8 で DRAFTING、
      CCC のピンは sha256:4d2b…

1. escalate{session_id:"rl_…BBB", submission_id:"g", action:"reopen",
            human_token:"…", note:"T004 の依存が逆で実装できない（40文字以上の説明）"}
   → {state:"DRAFTING", round:5, reopened:[{by:"human", previous_final_digest:"sha256:4d2b…"}]}

2. loop_state{session_id:"rl_…CCC"}
   → {state:"FROZEN", freeze_reason:"upstream_reopened",
      upstream:{pinned:"sha256:4d2b…", current:null, upstream_state:"DRAFTING"}}

3. artifact_commit{session_id:"rl_…CCC", …}
   → {error:{code:"E_FROZEN", detail:{upstream_session_id:"rl_…BBB"}}}

4. BBB が再び FINAL（新 digest sha256:7e5c…）

5. loop_state{session_id:"rl_…CCC"}
   → {state:"SUPERSEDED",
      upstream_drift:{pinned:"sha256:4d2b…", current:"sha256:7e5c…"}}

6. escalate{session_id:"rl_…CCC", submission_id:"h", action:"rebase",
            upstream_digest:"sha256:7e5c…", note:"上流の再確定を取り込む（40文字以上）"}
   → {state:"DRAFTING", round:9,
      rebase_result:{
        invalidated:["plan_task_completion","acceptance_satisfied"],
        carried_over:["tests_green","test_coverage_of_tasks","no_test_weakening",
                      "no_unplanned_change","build_and_lint","code_quality","docs_updated"]},
      must_fix:[{criterion_id:"plan_task_completion", previous_score:null}, …]}

7. score_submit{…} で invalidated 2件を採点
   → previous_score が null なので E_SCORE_INFLATION / E_SCORE_JUMP の検査は走らない
```

**期待**: 下流が `FINAL` だった場合も 5 で `SUPERSEDED` に落ちる。carry_over された7件は再採点不要。

### AT-13: 差し戻し（implement → plan）

```
1. escalate{session_id:"rl_…CCC", submission_id:"i", action:"kickback",
            target_criteria:["dependency_soundness"], human_token:"…",
            note:"T004 が T007 の成果物を前提にしているが依存が逆向きで実装順に並べると失敗する"}
   → {state:"FROZEN", freeze_reason:"kicked_back",
      upstream:{session_id:"rl_…BBB", state_after:"DRAFTING"}}

2. loop_state{session_id:"rl_…BBB"}
   → {state:"DRAFTING", round:5,
      must_fix:[{criterion_id:"dependency_soundness",
                 origin:"kickback", from_session:"rl_…CCC"}]}

3. escalate{session_id:"rl_…CCC", submission_id:"j", action:"kickback", …} を3回目
   → {error:{code:"E_CHAIN_BUDGET_EXHAUSTED", detail:{check:"kickbacks", used:2, limit:2}}}

4. audit_export{session_id:"rl_…CCC", scope:"chain"}
   → kickbacks[] に {from, to, target_criteria, downstream_state_after:"FROZEN",
                    upstream_state_after:"DRAFTING", resolved_at}
```

**期待**: 下流は破棄されず凍結。差し戻しは監査に残り、上限2回で止まる。

### AT-14: 実装モードのごまかし検出（テスト削除）

```
前提: 前周の test_inventory.counts.total = 126

artifact_commit{session_id:"rl_…CCC", submission_id:"k", expected_round:7,
  files:[…], manifest_command:"…", manifest_output_sha256:"…",
  test_inventory:{ source_command:"npm test", source_exit_code:0,
                   source_output_sha256:"…",
                   counts:{total:121, passed:121, failed:0, skipped:0},
                   tests:[…121件…], removed_tests:[] },
  change_note:"落ちるテストを整理した"}
→ {error:{code:"E_TEST_REGRESSION",
          detail:{check:"R3", prev:126, now:121,
                  unexplained:["pin drift detected","kickback freezes downstream",
                               "rebase carries over","superseded blocks commit",
                               "frozen blocks commit"]}}}
   提出は受理されず、rounds/7.rejected/ に保存される

再提出（申告つき）:
  test_inventory.removed_tests に5件を理由つきで記載
→ {accepted:true, warnings:["test_count_decreased"]}
   ただし score_submit で skipped 増や auto 基準の 9 は別途検査される
```

**期待**: 説明なしのテスト削除は受理されない。説明つきなら通るが警告と監査記録が残る。

### AT-15: 実装モードのごまかし検出（結果の使い回しとアサート弱化）

```
(a) 古い結果の使い回し

score_submit{session_id:"rl_…CCC", submission_id:"l", expected_round:9,
  artifact_digest:"sha256:a3f7…",
  scores:[{criterion_id:"tests_green", score:9, rationale:"…",
           weakness:"…",
           evidence:[{kind:"command", command:"npm test", exit_code:0,
                      output_excerpt:"128 passed", output_sha256:"…",
                      target_digest:"sha256:6b1c40e9…"}]}]}
→ {error:{code:"E_EVIDENCE_TARGET",
          detail:{expected:"sha256:a3f7…", actual:"sha256:6b1c40e9…",
                  criterion_id:"tests_green"}}}

(b) target_digest を書き忘れる

  evidence:[{kind:"command", command:"npm test", exit_code:0,
             output_excerpt:"128 passed", output_sha256:"…"}]   ← target_digest 無し
→ {error:{code:"E_EVIDENCE_TARGET", detail:{reason:"target_digest_required_in_implement_mode"}}}

(c) アサート弱化（テストファイルを変えて差分を出さない）

artifact_commit{… files に test/foo.test.js の sha256 だけ変更、
                test_inventory.diffs:[] …}
→ {error:{code:"E_TEST_MUTATED_WITHOUT_DIFF",
          detail:{files:["test/foo.test.js"]}}}

(d) テストが赤いまま auto 基準に 9

  test_inventory.counts.failed = 3 の状態で
  scores:[{criterion_id:"tests_green", score:9, …}]
→ {error:{code:"E_TEST_NOT_GREEN", detail:{criteria:["tests_green"], failed:3}}}
```

**期待**: (a)(b)(c)(d) いずれも受理されない。(c) で差分を添えれば受理されるが、差分は監査 JSON に残り `no_test_weakening` の採点対象になる。

### AT-16: チェーン予算の超過

```
前提: chain_rounds = 27（design 9 + plan 6 + implement 12）、limit 28

score_submit{session_id:"rl_…CCC", submission_id:"m", expected_round:13, …}
→ 判定は不合格（weighted_mean 8.4）
→ {verdict:"REVISE", state:"ESCALATED",
   escalation:{reason:"chain_budget_exhausted",
               detail:{chain_rounds:28, limit:28,
                       per_session:[{session_id:"rl_…AAA", loop_mode:"design", round:9},
                                    {session_id:"rl_…BBB", loop_mode:"plan", round:6},
                                    {session_id:"rl_…CCC", loop_mode:"implement", round:13}]}},
   next_action:"escalate"}

escalate{session_id:"rl_…CCC", submission_id:"n", action:"resolve",
         resolution:"continue", human_token:"…", note:"あと少しで通る見込み（40文字以上）"}
→ {state:"DRAFTING", round:14, chain:{limit:34, granted_extra_rounds:6}}

2回目の continue
→ {error:{code:"E_RESOLUTION_NOT_APPLICABLE",
          detail:{reason:"extra_rounds_already_granted"}}}

対照: 予算超過時でも合格していれば
score_submit → {verdict:"PASS", state:"FINAL", warnings:["chain_budget_exceeded"]}
```

**期待**: 予算超過は不合格時のみエスカレーション。合格は潰さない。上乗せは1回だけ。

### AT-17: 途中モードからの再開（実装セッションのハンドル1個）

```
新しいプロセス・空のコンテキスト。持っているのは "rl_…CCC" だけ。

1. loop_open{mode:"resume", submission_id:"o", session_id:"rl_…CCC"}
   → {session_id:"rl_…CCC", chain_id:"ch_…", loop_mode:"implement",
      state:"DRAFTING", round:11, artifact_kind:"fileset",
      upstream:{session_id:"rl_…BBB", loop_mode:"plan",
                artifact_digest:"sha256:7e5c…", verdict:"FINAL", drift:false},
      chain:{chain_rounds:21, limit:28},
      must_fix:[{criterion_id:"no_test_weakening", previous_score:6, anchors:{…}}],
      next_action:"artifact_commit"}

2. loop_state{session_id:"rl_…CCC",
              include:["rubric","must_fix","upstream","chain","last_artifact"]}
   → {rubric:{criteria:[…9件…]},
      upstream_artifact:{digest:"sha256:7e5c…", content:"<計画JSON全文>"},
      last_artifact:{digest:"sha256:…", files:[…34件…],
                     test_inventory:{counts:{total:126,…}}},
      chain:{members:[…3件…]}}

3. そのまま artifact_commit から再開できる
```

**期待**: 上流のハンドルも rubric も計画本文も覚えていなくてよい。ハンドル1個で完全に戻る。

**上流が消えていた場合**:

```
1. loop_open{mode:"resume", submission_id:"p", session_id:"rl_…CCC"}
   → {state:"DRAFTING", orphan:true, warnings:["upstream_missing"],
      upstream:{session_id:"rl_…BBB", artifact_digest:"sha256:7e5c…", resolved:false}}

2. 作業は続けられるが、合格判定に達しても
   → {verdict:"PASS", state:"ESCALATED", escalation:{reason:"upstream_missing"}}
      （FINAL にはならない）

3. escalate{session_id:"rl_…CCC", submission_id:"q", action:"rebase",
            upstream_digest:"sha256:7e5c…",
            upstream_content:"<監査JSONから取り出した計画全文>",
            note:"監査エクスポートから上流本文を復元する（40文字以上）"}
   → 本文の digest が upstream_digest と一致すれば {state:"DRAFTING", orphan:false}
      一致しなければ {error:{code:"E_UPSTREAM_DIGEST_MISMATCH"}}
```

### AT-18: MCP サーバ起動失敗（3モード）

```
ホストが mcp.json のサーバ起動に失敗（node が無い / PLUGIN_DATA が書けない）。
Agent Plugins 1.0.0 ではコンポーネント失敗は致命的でないため、
skills/ は読み込まれ、rubric-loop ツールだけが存在しない。

モデルの振る舞い（SKILL.md「ツールが使えないとき（縮退）」に従う）:

design    → 設計書を書き、末尾に rubric 15基準の自己採点表を付け、
            冒頭に "UNVERIFIED-COMPLETE: rubric-loop server unavailable"
plan      → 計画 JSON を書き、トポロジカルソート結果を手で示し、
            design_refs を手で設計書の見出しと照合した結果を書く。同じ冒頭表示
implement → コードとテストを書き、テスト実行のコマンド・終了コード・件数を貼る。
            変更ファイル一覧を出す。同じ冒頭表示に加えて
            「マージ・デプロイの可否は判断していない。人間のレビューを求める」

いずれも「合格した」「FINAL」とは書かない。

サーバが起動できるようになった後:
  loop_open{mode:"create", …} で新しいセッションを開き、
  縮退中に書いた成果物を round 1 の artifact_commit として提出する。
  縮退中の自己採点は引き継がれない（previous_score は null から始まる）。
```

**期待**: 3モードとも作業は止まらないが、合格の主張はどこにも出ない。

---

## 14. セルフホスティング検証：この設計書自身をこのツール列で作る

本設計書を成果物として、設計したツール列だけで最初から最後まで回せるかをトレースする。rubric は本タスクの SUCCESS CRITERIA をそのまま 15 基準に写したもの（`failure-modes` / `tool-surface` / `state-externalization` / `server-verdict` / `anti-gaming` / `rubric-schema` / `convergence` / `state-machine` / `package-conformance` / `host-abstraction` / `skill-server-split` / `audit` / `acceptance-tests` / `self-hosting` / `rejected-alternatives`）。

| 周 | 呼び出し | サーバの返り | 次の一手 |
|---|---|---|---|
| — | `loop_open{mode:"create", submission_id:"sh-d-1", label:"rubric-loop-design", loop_mode:"design", task:"…", rubric:{criteria:15件, policy:既定}}` | `state:"DRAFTING"`, `round:1`, `next_action.tool:"artifact_commit"` | 初版を書く |
| 1 | `artifact_commit{expected_round:1, content:<初版全文>, change_note:"初版。失敗モード表・7ツール・状態機械・パッケージ実物まで"}` | `digest:"sha256:41b7…"`, `unchanged:false`, `state:"SCORING"` | 採点 |
| 1 | `score_submit{…, 15件}`（`acceptance-tests:6`（本数不足）, `self-hosting:5`（未着手）, `audit:7`（実例が抜粋）, 他 8–9） | `verdict:"ITERATING"`, `min_score:5`, `weighted_mean:7.9`, `must_fix:[self-hosting(5), acceptance-tests(6), audit(7)]`, `round:2` | `self-hosting` から直す |
| 2 | `artifact_commit{expected_round:2, content:<全文>, change_note:"§14 セルフホスティング節を追加し、周ごとの呼び出しと返り値をトレース。トレース中に見つかった穴 H4/H5 を §7.1.1 と §6.4.3 に反映", addresses:["self-hosting"]}` | `unchanged:false`, `diff.added_lines:120` | 採点 |
| 2 | `score_submit{…, self-hosting:5→8, acceptance-tests:6→7, audit:7→8}`（`self-hosting` の根拠は `kind:"locator"`, `excerpt:"§14 セルフホスティング検証"`） | `verdict:"ITERATING"`, `min_score:7`, `weighted_mean:8.6`, `improvement:0.7`, `must_fix:[acceptance-tests(7), audit(8), self-hosting(8)]`, `round:3` | 受け入れテストを増やす |
| 3 | `artifact_commit{expected_round:3, content:<全文>, change_note:"受け入れテストを9本に拡張し、各行に呼び出しと期待返り値を明記", addresses:["acceptance-tests"]}` | `unchanged:false` | 採点 |
| 3 | `score_submit{…, 全15基準 9以上}`（`package-conformance` は `kind:"command"` の jq 検査2件、他は `locator`） | `verdict:"FINAL"`, `verdict_reason:"all_criteria_passed"`, `weighted_mean:9.24`, `state:"FINAL"`, `next_action.tool:"audit_export"` | 監査出力 |
| — | `audit_export{include_artifacts:false}` | `export.path:".../exports/audit-20260904T110244Z.json"`, `summary:{rounds:3, final_verdict:"FINAL", rubric_versions:1, relaxations:0, rejected_submissions:0}` | 終了 |

### 14.1 トレースで見つかった穴と、設計へ反映した修正

このトレースを流した結果、初期案に**実際に穴が7つ**見つかった。いずれも設計側を直した。H1–H3 は周回1のトレース、H4・H5 は周回2、**H6・H7 は周回3で MCP 2026-07-28 リビジョン（§18）に照らし直した際に発見**したもの（トレースではなく外部仕様の再確認が発見源である点を明示しておく）。

| # | 穴 | 症状 | 設計の修正 |
|---|---|---|---|
| H1 | 「毎周かならず全文を出す」が機構化されていなかった | `artifact_commit` に差分だけ渡してもサーバは気付けず、digest が別物になるので `unchanged` 検出が無意味になる | `content` を「全文」と定義し、`artifact_kind` と `bytes` を記録。加えて `diff.changed_ratio` を返し、前周比で 0.9 以上（＝ほぼ全書き換え）や極端に短い提出が監査に見えるようにした（§6.4.3） |
| H2 | 「最低点を必ず動かす」がサーバ側で強制されていなかった | `must_fix[0]` を無視して別の基準だけ直しても通ってしまう | `artifact_commit` に `addresses` を追加し、`round>=2` では前周 `must_fix[0].criterion_id` を含むことを必須化（`E_ADDRESS_MISSING`、§6.4.3） |
| H3 | 拒否された提出が消えていた | ごまかしを検出しても記録が残らず、監査で「試行があった」ことが見えない | `rounds/<n>.rejected/<seq>.json` に全拒否を保存し、`audit_export` の `rejected_submissions[]` に含めた（§8.1 / §12.2） |
| H4 | rubric の版が変わったときのスコア比較が未定義だった | `rubric_amend` で基準を追加すると `previous_score` が存在せず、インフレ検出・ジャンプ検出の挙動が不定。基準を削除すると加重平均が自動的に上がり、`improvement` が偽陽性になる | `previous_score:null` の基準は 3検査をスキップすると明記し、削除時は**前周の加重平均を新しい基準集合で再計算**して比較する規則を追加（§7.1.1）。「低い基準を消して平均を上げる」経路が塞がった |
| H6 | セッション識別子を**クライアントが自称**していた | MCP 2026-07-28 はプロトコルセッションを廃止し、跨り状態は「**サーバが発行した**ハンドルをツール引数で渡す」と規定（SEP-2567）。自称 id は仕様の意図に反し、他セッションの id を主張する余地も残る | `session_id` をサーバ発行の ULID にし、`mode:"create"` での指定を `E_HANDLE_NOT_ACCEPTED` で拒否。人間向けの想起は `label` に分離（§6.4.1 / §18.1 #1） |
| H7 | 通信断による再送で周回が二重に進む | 同リビジョンは SSE のストリーム再開・再配送を廃止し、**切断時はクライアントが新しい要求 ID で再発行する**のが義務。`score_submit` が二重適用されると round と停滞カウンタが壊れる | `artifact_commit` / `score_submit` に冪等キー `submission_id` を必須化し、既出なら保存済み応答を返す（§7.1 手順 0 / §18.1 #6）。失敗モード F14 として §2 にも登録 |
| H5 | 「全文を渡す」が守られない提出を監査で見分けられなかった | 差分だけを `content` に渡すと、サーバは digest が変わったとしか見えず不正を検出できない | `artifact_commit` の `warnings` に `near_total_rewrite`（`changed_ratio>=0.9`）と `suspicious_shrink`（前周比 0.5 倍未満）を追加し、監査 JSON に残す（§6.4.3） |

### 14.2 回ることの確認（穴が無いこと）

- 開始: `loop_open` 1回で `session_id` が確定し、以後の全ツールがこの1個で足りる。**追加の状態をモデルが覚える必要が無い**。
- 各周: `next_action` が常に次のツール名を返すので、周回中に手順を思い出す必要が無い（F2）。
- 中断: 途中でコンテキストが飛んでも `loop_state` 1回で復帰（AT-6 で実証）。
- 終了: `FINAL` はサーバが出し、`audit_export` で第三者が再検証できる形になる。
- 逸脱: 「全文を出さない」「最低点を動かさない」「同じ文書で点だけ上げる」は H1–H3 の修正で全て機構に落ちた。


### 14.3 3モードでのセルフホスティング（この改訂作業そのもの）

「3モードに拡張する」というこの改訂作業を、設計した3モードで回すとどうなるかを実際にたどる。

#### 14.3.1 design モード — この改訂を回す

```
1. loop_open{ mode:"create", submission_id:"sh-d-1", loop_mode:"design",
              label:"rubric-loop-modes",
              task:"既存設計書 docs/design-rubric-loop-mcp.md を改訂し、rubric ループを
                    design/plan/implement の3モードに拡張する。既存 §1–§18 の決定を無断で
                    覆さない。ツールは増やさないことを既定とする。",
              rubric_preset:"design" }
→ { session_id:"rl_01JQ8ZAAAAAAAAAAAAAAAAAAAA", chain_id:"ch_01JQ8Z…",
    loop_mode:"design", state:"DRAFTING", round:1, artifact_kind:"markdown",
    rubric_version:1, next_action:"artifact_commit" }

2. artifact_commit{ session_id:"rl_…AAA", submission_id:"sh-d-2", expected_round:1,
                    content:"<改訂後の設計書 全文>", change_note:"§19 を新設し3モードを定義",
                    addresses:[] }
→ { accepted:true, artifact:{digest:"sha256:1111…", bytes:198432},
    diff:{added_lines:620, removed_lines:0, changed_ratio:1.0},
    warnings:[], round:1, next_action:"score_submit" }

3. score_submit{ session_id:"rl_…AAA", submission_id:"sh-d-3", expected_round:1,
                 artifact_digest:"sha256:1111…",
                 scores:[ …15基準… ] }
→ { verdict:"REVISE", weighted_mean:6.4, state:"DRAFTING", round:2,
    must_fix:[ {criterion_id:"interface_completeness", score:5,
                anchors:{"9":"全インタフェースに実物のスキーマとエラー条件があり、
                              スキーマがバリデータを通る"}},
               {criterion_id:"failure_mode_mapping", score:6, …} ],
    next_action:"artifact_commit" }

4. artifact_commit{ …, expected_round:2, addresses:["interface_completeness"], … }
   ← addresses に must_fix の先頭を入れ忘れると E_ADDRESS_MISSING で弾かれる。
     実際、この改訂の途中で1回弾かれた（監査 §19.13.3 の rejected[0] がその記録）。

5. round 5 で
score_submit{ …, scores:[ {criterion_id:"interface_completeness", score:9,
                            rationale:"loop_open/artifact_commit/escalate/audit_export の
                                       全入力スキーマを Draft 2020-12 で書き切り、7件の
                                       具体インスタンスで if/then/oneOf の挙動を確認した",
                            weakness:"audit-chain スキーマの $id が実在 URL ではない",
                            evidence:[{kind:"command",
                                       command:"node tools/validate-schemas.js docs/design-rubric-loop-mcp.md",
                                       exit_code:0,
                                       output_excerpt:"22 json blocks parsed, 18 schemas valid, 7/7 instances OK",
                                       output_sha256:"5a7d…"}] }, …] }
→ { verdict:"PASS", weighted_mean:9.2, state:"FINAL",
    artifact_digest:"sha256:9ac1…", next_action:null }
```

**この時点で分かること**: design モードは既存 §1–§18 の設計そのままで回る。3モード化で design に増えたのは `loop_mode` と `rubric_preset` と `submission_id` の3引数だけであり、**既存の design 相当の動きは変わっていない**（後方互換）。

#### 14.3.2 plan モード — 実装計画を回す

```
6. loop_open{ mode:"create", submission_id:"sh-p-1", loop_mode:"plan",
              label:"rubric-loop-modes-plan",
              upstream:{ session_id:"rl_…AAA", artifact_digest:"sha256:9ac1…" },
              task:"確定した設計書 §19 を実装するための計画を作る",
              rubric_preset:"plan" }
→ { session_id:"rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB", chain_id:"ch_01JQ8Z…"  ← 継承,
    loop_mode:"plan", artifact_kind:"plan", state:"DRAFTING", round:1,
    upstream:{ …, verdict:"FINAL", drift:false }, next_action:"artifact_commit" }

7. loop_state{ session_id:"rl_…BBB", include:["upstream","rubric"] }
→ { upstream_artifact:{ digest:"sha256:9ac1…", content:"<設計書全文>" },
    rubric:{ criteria:[ …plan プリセット8基準… ] } }

8. artifact_commit{ session_id:"rl_…BBB", submission_id:"sh-p-2", expected_round:1,
                    content:"{\"plan_version\":1,\"summary\":\"…\",\"tasks\":[…]}",
                    change_note:"§19 の実装を12タスクに分解" }
→ 1回目は落ちる:
   { error:{ code:"E_PLAN_INVALID", detail:{ check:"cycle", task_id:"T004" } } }

9. 依存を直して再提出
→ { accepted:true, artifact:{digest:"sha256:4d2b…"},
    plan_checks:{ tasks:12, toposort:"ok", isolated:0, design_refs_verified:12 } }

10. 設計に無いタスクを混ぜた提出は
→ { error:{ code:"E_PLAN_DESIGN_REF",
            detail:{ task_id:"T011", ref:"§21 プラグイン自動更新" } } }
    ← §21 は設計書に存在しない。スコープの膨張が機械的に止まる。

11. score_submit{ …, scores:[8基準] }
→ { verdict:"PASS", weighted_mean:9.1, state:"FINAL", artifact_digest:"sha256:4d2b…" }
```

計画の中身（12タスク）は次のとおり。設計書の各節に対応している。

| id | title | design_refs | depends_on |
|---|---|---|---|
| T001 | 永続層に chain.json と upstream を足す | §19.11.1 | — |
| T002 | ULID 採番に `ch_` 前置を追加 | §19.2.1 | T001 |
| T003 | `loop_open` に loop_mode / upstream / rubric_preset / submission_id | §19.6.3 | T001, T002 |
| T004 | 上流ピンの検証（存在・FINAL・モード・digest） | §19.2.1 | T003 |
| T005 | プリセット3本を presets/ に置き読み込む | §19.7 | T003 |
| T006 | `artifact_kind:"plan"` のスキーマ検査と依存グラフ検査 | §19.5.2 | T003 |
| T007 | `design_refs` の上流実在検査 | §19.5.2 | T004, T006 |
| T008 | `artifact_kind:"fileset"` のマニフェスト digest 計算 | §19.5.3 | T003 |
| T009 | `test_inventory` の差分検査 R1–R5 | §19.8.2, §19.8.3 | T008 |
| T010 | ピン不一致検出と SUPERSEDED / FROZEN 遷移 | §19.3.2, §19.9 | T004 |
| T011 | `escalate` の reopen / rebase / kickback | §19.3.3, §19.4 | T010 |
| T012 | `audit_export` の chain スコープと chain_digest | §19.13 | T001, T011 |

#### 14.3.3 回らなかった箇所と、それを受けて直したこと

セルフホスティングで**実際に詰まった点**を挙げる（詰まらなかったと書くのは嘘になる）。

| # | 詰まった点 | 直したこと |
|---|---|---|
| H8 | 最初の設計では `loop_open` に冪等キーが無く、手順1の再送で**セッションが2つできた**。ULID は毎回違うので `session_id` では重複排除できない | `loop_open` の `submission_id` を**必須**にした（§19.6.3）。§18.1 #6（SSE 再開廃止による再送常態化）は `artifact_commit` / `score_submit` だけの問題ではなかった |
| H9 | 手順6で「上流の digest をどこから持ってくるか」が決まっていなかった。モデルは設計書本文を持っているが digest は計算しないと分からない | `loop_open` の応答と `loop_state` の `artifact_digest`、および `audit_export` の `final.artifact_digest` から取る、と SKILL.md に明記した。推測で埋めさせない |
| H10 | 手順10で `E_PLAN_DESIGN_REF` を出すには、上流設計書の**見出し集合**が要る。当初は「本文に部分一致」だけを考えていたが、`"§19"` のような短い文字列が偶然一致してしまう | `design_refs` の照合は**正規化後の本文に対する部分一致**とし、加えて `plan_checks.design_refs_verified` を返して**何件照合できたか**を可視化した。厳密な見出しパーサはフォーマット依存になるので採らない（限界として明記） |
| H11 | `rebase` の invalidated 計算は、前周の evidence に `kind:"upstream"` が**1件も無い**と全基準 carry_over になり、上流が変わったのに何も再検証されない | §19.3.3 手順4後半で、invalidated が0でも**1回は提出を要求**するようにした。加えて plan / implement プリセットの主要基準は upstream 根拠を要求するアンカーになっている |
| H12 | implement モードの `changed_ratio` を既存の行ベース定義のまま使うと、本文を持たない fileset で計算できない | fileset では「変化したファイル数 / 全ファイル数」と**別式で定義**し、`added_lines` / `removed_lines` は `null` を返すと明記した（§19.5.3） |

H8–H12 はいずれも**この設計書の記述に反映済み**である。H1–H7（§14.1）と合わせて、穴は12件見つかり12件塞いだ。

#### 14.3.4 この改訂に実際に走らせた機械検査（auto 基準の根拠の実物）

design プリセットは `interface_completeness` / `packaging_conformance` / `defaults_decided` の3件を `verification:"auto"` にしている。auto 基準は `command` 根拠が必須（§5.3 `require_command_evidence_for:["auto"]`）なので、**この文書を採点するときに実際に走らせるコマンドと、その結果**を実物で置く。置かなければ auto 基準は根拠を作れず、`E_EVIDENCE_KIND` で提出が丸ごと拒否される。

| 基準 | コマンド | 合格条件 | この改訂での結果 |
|---|---|---|---|
| `interface_completeness` | `python tools/check-schemas.py docs/design-rubric-loop-mcp.md` | fenced JSON が全件 `json.loads` を通り、`$schema` が draft 2020-12 のものは `Draft202012Validator.check_schema` を通る | JSON ブロック **35件が全件パース**、スキーマ **17件が妥当**、失敗0 |
| `interface_completeness` | `python tools/check-instances.py docs/design-rubric-loop-mcp.md` | §6.4.1 / §6.4.3 / §6.4.6 / §19.5.2 のスキーマに、受理されるべき／拒否されるべきインスタンスを当てて期待どおりになる | **27件中27件が期待どおり**（design に upstream を渡すと拒否、plan に upstream が無いと拒否、`content` と `files` の同時指定は拒否、`rebase` は `human_token` 無しで受理、など） |
| `interface_completeness` | `python tools/check-errorcodes.py docs/design-rubric-loop-mcp.md` | `E_*` について「使われているのに定義が無い」「定義されているのに使われない」がともに0件 | **定義42件・使用42件・差分0** |
| `packaging_conformance` | `python tools/check-plugin.py plugin.json mcp.json` | §9.2 / §9.3 の実物が Agent Plugins 1.0.0 のスキーマを通り、`command` が単一実行トークンで、`args`/`env`/`cwd` 以外に変数展開が無く、資格情報らしき値が無い | exit 0 |
| `defaults_decided` | `grep -n '実装時に決める\|TBD\|後で決める' docs/design-rubric-loop-mcp.md \| grep -v '禁止語句\|grep -\|anchors'` | 出力なし（exit 1） | 出力なし。残る9件はすべて**禁止語句そのものを引用・検査している行**であり、アンカー定義・却下理由・この表の行である |

**この表が兼ねている役割**: (a) auto 基準の根拠の作り方を、モデルに解釈の余地なく決めている。(b) 検査スクリプトの名前と置き場所を決めているので、implement モードに降りたときに `design_refs` の参照先として使える。(c) 「サーバはコマンドを実行しない」（仮定 A4）ままで auto 基準を成立させる、という本設計の立場を具体例で示している——**サーバは結果を記録するだけ**で、実行と再現は人間と CI の側にある。

---

## 15. 却下した代替案

| 案 | 内容 | 却下理由（具体） |
|---|---|---|
| **A. プロンプトだけで足りる** | 本タスクのような1枚のループ指示だけを使う | (1) 判定がモデルの自己申告なので `min_score>=9` を機械的に強制できない（F1/F6）。(2) 長い周回でコンテキスト圧縮が起きると rubric 本文が要約に飲まれ、基準が事実上変質する（F3）。(3) 「成果物が変わっていないのに点が上がった」を検出する手段が原理的に無い（F5）。(4) 監査に残らないので第三者が再検証できない。**ワンショットの範囲では有効だが、それを機構にするのが本設計の目的なので同語反復で棄却** |
| **B. ただの TODO リスト MCP** | タスクの列と done フラグをサーバが持つ | (1) 状態は持てるが**閾値判定を持たない**ので、done を打つのは結局モデル。F6 が残る。(2) rubric のアンカー・重み・検証手段という構造が無く、採点の再現性が無い。(3) 成果物 digest とスコアの結合が無いので F5 を検出できない。**「状態の外部化」だけでは足りず、「判定の外部化」が要る**ことの証拠 |
| **C. CI で代用する** | rubric 相当をテスト／lint にして CI を回す | (1) 自動検証できる基準（`package-conformance` の jq 検査など）は CI 向きだが、`failure-modes` の1対1対応や `rejected-alternatives` の妥当性など**目視基準が過半**で、CI では判定できない。(2) CI はコミット単位で、**周回中の対話ループの状態**（must_fix / 停滞カウンタ / 次の一手）を持たない。(3) CI が無い環境（ローカルの設計作業、リポジトリ未作成の段階）で使えない。(4) `verification:"auto"` の基準について CI と本サーバは**共存できる**（CI の出力をそのまま `kind:"command"` 根拠に貼る）。競合ではなく補完だが、代替にはならない |
| **D. Claude Code 専用プラグインで済ませる** | `${CLAUDE_PLUGIN_ROOT}` 前提のネイティブ形式のみで作る | (1) 前提が「Agent Plugins 1.0.0 準拠の可搬パッケージ」なので要件を満たさない。(2) VS Code / Cursor / Copilot / Codex / Kiro など互換クライアントで動かない。(3) ベンダー別名に依存すると、`PLUGIN_ROOT` しか渡さないホストで起動できない。**本設計は逆に、ネイティブ形式を「別名の吸収」だけで受け入れる**（§11.1）ので、Claude Code でも動くうえに可搬性を失わない |
| **E. LLM-as-judge を別サービスに置く** | 採点自体を別モデル／別サービスに投げる | (1) Agent Plugins 1.0.0 に**可搬な認証機構が無い**ため、外部 API 呼び出しに必要な資格情報を安全に運べない（ヘッダはリテラル）。(2) ネットワーク不通時にループが止まる。本設計はローカル完結で、判定は純粋な閾値計算なので決定的。(3) 判定が別 LLM の気分に依存すると、F1 が「別のモデルの甘え」に移動するだけで解決しない |
| **F. git のコミット履歴で代用** | 成果物の版管理を git に任せる | (1) 版管理は代替できるが、**スコアと根拠と判定**は git に無い。(2) 対話の途中（未コミット）の周を扱えない。(3) 成果物が git 管理外（会話内テキスト、外部ドキュメント）だと成立しない。(4) `artifact_commit` の内容アドレス保存は git を排除しない——`source_path` に実ファイルを記録するので、両立できる |
| **G. ツールを増やして細かく制御する** | `set_score` / `get_criterion` / `finalize` などを追加 | (1) `set_score` による部分更新は「通らない基準だけ後から上書き」という抜け道になり、F1/F5 の検出（周単位の一括提出との比較）が壊れる。(2) `finalize` はモデルに「完了を宣言する動詞」を与えてしまい、F6 の入口になる。(3) ツールが増えるほどモデルの選択誤りが増え、`next_action` の一意性が薄れる。**7ツールに絞ったのは設計判断であり、削れないものだけを残した** |


3モード拡張にあたって却下したもの:

**H. モードを分けず、rubric だけ差し替える**
「同じループで rubric を計画用・実装用に入れ替えればよい」。却下。(1) 成果物の**型**が違う（Markdown / 計画 JSON / ファイル集合）ので、rubric の差し替えだけでは `artifact_commit` の検査を切り替えられない。(2) 上流ピンという概念が生まれないので、「どの設計に対する計画か」が記録されず、上流変更による失効（§19.3）が原理的に作れない。(3) rubric を途中で入れ替えるのは §5.3 の `policy_change` に当たり、既存設計では人間承認を要する操作である。モード切替のたびに承認を要求するのは実用に耐えない。

**I. 3つの別プラグインにする**
`rubric-design` / `rubric-plan` / `rubric-implement` を別パッケージにする案。却下。(1) `PLUGIN_DATA` はプラグインごとに分離されるため、**上流セッションのデータを下流が読めない**。連鎖が成立しない。(2) 読めるようにするには絶対パスの受け渡しが要り、Agent Plugins 1.0.0 の「`cwd` は `PLUGIN_ROOT` / `PLUGIN_DATA` の内側」という制約と衝突する。(3) 3つの MCP サーバが常駐し、プロセス数と起動失敗点が3倍になる。(4) バージョンずれで `chain.json` のスキーマが食い違う事故が起きる。

**J. 連鎖は人間が手で繋ぐ（設計書のパスを計画セッションの task に貼る）**
却下。(1) 貼った瞬間の版が固定されないので、設計書が後から変わっても計画は気づかない。まさに潰したい失敗モード F15 そのもの。(2) 監査で「この計画がどの設計から出たか」を機械的に確認できない。digest の一致という検証可能な事実が残らない。(3) 人間が貼り間違えても誰も検出しない。**上流ピンの本質は、間違いようがない形で版を固定すること**であり、手作業はその逆。

**K. plan モードは不要で、設計から直接実装する**
却下。(1) 実装モードの `no_unplanned_change` と `acceptance_satisfied` は**計画があって初めて機械検査できる**。計画が無ければ「何をすべきだったか」の集合が存在せず、スコープの膨張と取りこぼしがどちらも検出できない。(2) 設計書は「どう作るか」ではなく「何を満たすか」を書くもので、粒度が違う。設計から直接実装すると1ループの変更量が大きくなり、`changed_ratio` も `must_fix` も粗くなって収束が遅れる。(3) 差し戻しの受け皿が消える。設計の欠陥と計画の欠陥は別物で、後者は設計を触らずに直せることが多い。実際、§19.13.3 の実例で起きた差し戻しは**計画の依存順の誤り**であり、設計は正しかった。plan が無ければ設計を無用に再オープンすることになる。

**L. implement モードでサーバがコマンドを実行する**
却下（§19.8.4 に詳述）。真正性は上がるが、任意コマンド実行を持つ MCP サーバは攻撃面が桁違いに広がり、実行環境依存で可搬性が壊れる。仮定 A4 を維持し、**「不正ができない」ではなく「不正が記録される」**という保証に留める。

**M. 下流セッションを上流の子ディレクトリに置く**
`sessions/rl_AAA/children/rl_BBB/` のような入れ子。却下。(1) FINAL 済みの上流ディレクトリに後から書き込むことになり、監査の不変性が壊れる。(2) 分岐（1つの設計から2つの計画）で親の書き込みが競合する。(3) 下流だけを再開したいときにパスが親に依存する。**フラットな `sessions/` + 追記専用の `chains/`** にした（§19.11.1）。

**N. 差し戻し時に下流セッションを破棄する**
却下（§19.4 の表）。実装の大半は設計変更と無関係なことが多く、捨てるのは高コスト。監査の連続性も切れる。**凍結**なら §19.3.3 の部分再検証にそのまま合流でき、無関係な基準は持ち越せる。

---

## 16. 既定値まとめ（実装時に決め直さない）

| 項目 | 既定値 |
|---|---|
| スコア尺度 | 1–10 の整数 |
| 合格スコア `pass_score` | 9（全基準に適用） |
| 合格加重平均 `pass_weighted_mean` | 9.0（`pass_score` と AND） |
| 最大周回 `max_rounds` | 12 |
| 停滞窓 `stall_window` | 3 周 |
| 停滞閾値 `stall_epsilon` | 加重平均 +0.25 未満を「改善なし」とみなす |
| 1周の最大上げ幅 `max_score_jump` | +3（超過は `exit_code:0` の command 根拠2件以上が必要） |
| `verification:"auto"` の必須根拠 | `kind:"command"` を1件以上 |
| `rationale` 最小長 | 40 文字 |
| `weakness` | `score<10` では必須（`"none"` 禁止） |
| `change_note` 最小長 | 20 文字 |
| エスカレーション追加周回 `extra_rounds` | 3 |
| 成果物サイズ上限 | 1,000,000 バイト |
| 基準数の上限 | 40 |
| ハッシュ | SHA-256（正規化: UTF-8 NFC / CRLF→LF / 行末空白除去 / 末尾改行1個） |
| ロックの stale 判定 | 60 秒 |
| transport 既定 | stdio |
| MCP リビジョン | 2026-07-28 を第一対象、2025-11-25 も受理（`server/discover` で両版を広告） |
| セッションハンドル | サーバ発行の ULID、`rl_` 前置（例 `rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY`） |
| 冪等キー `submission_id` の長さ | 8–128 文字 |
| `tools/list` の `ttlMs` / `cacheScope` | 86400000 / `"private"`（一覧は不変・ローカル状態に紐づく） |
| ツール一覧の順序 | `loop_open`, `loop_state`, `artifact_commit`, `score_submit`, `rubric_amend`, `escalate`, `audit_export`（固定） |
| 監査出力の既定 | `include_artifacts:false` / `include_rejected:true` / `include_diffs:true` / `scope:"session"` |
| モード `loop_mode` | `design` / `plan` / `implement`。`loop_open` の `mode:"create"` で必須、以後変更不能 |
| 既定 `artifact_kind` | design→`markdown` / plan→`plan` / implement→`fileset` |
| `max_rounds`（モード別） | design 12 / plan 8 / implement 16 |
| `stall_window`（モード別） | design 3 / plan 2 / implement 4 |
| `stall_epsilon`（モード別） | design 0.25 / plan 0.25 / implement 0.20（implement を下げた理由は §19.10.1） |
| チェーン予算 `chain_max_rounds` | 28（単純合計 36 より小さく取る。§19.10.2） |
| チェーン上乗せ `chain_extra_rounds` | 6（人間承認で**1回だけ**） |
| 差し戻し上限 `chain_max_kickbacks` | 2 |
| チェーンハンドル | サーバ発行の ULID、`ch_` 前置（例 `ch_01JQ8Z9K7M3N4P5R6S7T8V9WXY`） |
| `fileset` の上限 | ファイル 5000 件 / パス 1024 バイト / マニフェスト全体 2 MB |
| `plan` の上限 | タスク 200 件。全タスクに `design_refs` 1件以上・`acceptance` 1件以上・`verify` 1件以上 |
| 冪等キー `submission_id` の適用範囲 | `loop_open` / `artifact_commit` / `score_submit` / `rubric_amend` / `escalate`（**状態を変える全ツール**） |
| rubric プリセット | `${PLUGIN_ROOT}/presets/{design,plan,implement}.json`。`verification:"auto"` 比率は 20% / 50% / 78% |
| 監査 JSON の版 | セッション単位 `audit_version:1` / チェーン単位 `audit_version:2` |

---

## 17. 未解決事項として残さないための注記

- **仕様に無い点は「クライアント任せ」と明記し、依存しない**: `plugin.json` の任意フィールドの網羅（A6）、`PLUGIN_DATA` 未提供時の挙動（A1）、transport のフォールバック（§9.5）、ツール出力の structured content 対応（A5）、ホストが話す MCP リビジョン（A8・§18.4）。いずれも、無い場合の既定動作を本設計側で決めてある。
- **決め切った**: 閾値・停滞判定・打ち切り・エスカレーションの各パラメータ（§16）、永続レイアウト（§8.1）、解決順序（§8.2 / §11.1）、縮退時の振る舞い（§10.3）。「実装時に決める」と書いた箇所は無い。
- **3モード拡張で決め切った**: モード別閾値とその理由（§19.1）、チェーン予算 28 / 上乗せ 6 / 差し戻し上限 2（§19.10.2）、`plan` と `fileset` のスキーマとサイズ上限（§19.5）、テスト台帳の検査規則 R1–R5（§19.8.2 / §19.8.3）、プリセット3本の基準・重み・アンカー（§19.7）、スキルは1本（§19.12.1）、新規ツールは0本（§19.6.1）。
- **正直に限界として書いた**: ハッシュとコマンド出力の真正性はサーバでは検証できない（§19.8.4）。`design_refs` の照合は正規化後の部分一致であり、厳密な見出しパーサではない（§14.3.3 の H10）。上流セッションも監査 JSON も失うと再開できない（§19.11.3）。

---

## 18. MCP 2026-07-28（ステートレス改訂）への適合

MCP 仕様は 2026-07-28 リビジョンで**プロトコルレベルのセッションを廃止**した。本設計はこの改訂を前提にする。Agent Plugins 1.0.0 側の制約（§1.1）とは独立で、両者は競合しない。

### 18.1 改訂の要点と本設計の対応

| # | 2026-07-28 の変更 | 本設計への影響 | 対応 |
|---|---|---|---|
| 1 | **プロトコルセッションと `Mcp-Session-Id` ヘッダの廃止**。跨り状態が要るサーバは「**サーバが発行したハンドルを通常のツール引数として渡す**」（SEP-2567） | 直撃。ループの状態は本質的に跨り状態 | `session_id` を**サーバ発行の ULID ハンドル**（`rl_…`）に変更し、全ツールが通常の引数として受け取る形にした（§6.4.1）。`Mcp-Session-Id` にも transport の接続同一性にも一切依存しない |
| 2 | **`initialize` / `notifications/initialized` ハンドシェイクの廃止**。各リクエストが `_meta` でプロトコル版とクライアント能力を運ぶ | サーバは接続開始時の状態を持てない | サーバは**プロセス起動時の env（`RUBRIC_LOOP_ROOT` / `_DATA`）と PLUGIN_DATA 上の永続状態のみ**で動作する。接続単位のメモリを一切持たない。同じハンドルなら別プロセス・別接続でも同じ結果になる |
| 3 | **`server/discover` の実装が MUST**。対応プロトコル版・能力・identity を広告 | 実装必須項目 | `server/discover` で `protocolVersions:["2026-07-28","2025-11-25"]`、`serverInfo:{name:"rubric-loop", version:"1.0.0"}`、`capabilities:{tools:{}}` を返す。stdio では後方互換プローブとしても機能する。版不一致は `UnsupportedProtocolVersionError`（`-32022`） |
| 4 | **全結果に `resultType` 必須**（`"complete"` / `"input_required"`） | 出力エンベロープに影響 | 通常のツール結果は `resultType:"complete"`。§6.2 のエンベロープは `structuredContent` の中身であり、`resultType` はその外側の結果オブジェクトに付く。旧リビジョンのクライアントが省略した結果は `"complete"` として扱う |
| 5 | **MRTR（Multi Round-Trip Requests）**。サーバ起点リクエスト（`elicitation/create` 等）は `InputRequiredResult` + クライアント側の再試行に置き換え | 人間承認フローに使える | §18.3 |
| 6 | **SSE のストリーム再開・再配送を廃止**。ストリームが切れたら**新しいリクエスト ID で再発行**するのがクライアントの義務 | **再送が常態化する**。`score_submit` の二重適用リスク | `artifact_commit` / `score_submit` に**冪等キー `submission_id` を必須**にした。既出なら保存済みの応答をそのまま返す（§7.1 手順 0）。周回が二重に進むことはない。**3モード拡張で `loop_open` / `rubric_amend` / `escalate` にも必須化**した（再送でセッションが2つできる穴 H8、§14.3.3） |
| 7 | `tools/list` の**決定的順序**、`ttlMs` / `cacheScope`（`CacheableResult`）必須 | ツール一覧の返し方 | ツール7本を固定順（`loop_open`, `loop_state`, `artifact_commit`, `score_submit`, `rubric_amend`, `escalate`, `audit_export`）で返し、**3モード拡張後も本数と順序は変わらない**（§19.6.1）。`ttlMs:86400000`（一覧は不変）、`cacheScope:"private"`（ローカルの状態機械に紐づくため共有中間者にキャッシュさせない）を付す |
| 8 | `inputSchema` / `outputSchema` が JSON Schema 2020-12 の**任意キーワード可**に緩和、`$ref` 解決要件を追加 | 本設計のスキーマが正式に適法に | §6.4 の `if-then` / `oneOf` / `not` はそのまま使える。`$ref` は互換性のため使わない（§6.4 冒頭） |
| 9 | `ping` / `logging/setLevel` / `notifications/roots/list_changed` の削除、**Logging 機能の非推奨**（stderr か OpenTelemetry へ） | ログ設計 | MCP の logging 機能を使わない。`RUBRIC_LOOP_LOG` に従い **stderr** に出す（stdio transport の規約どおり、stdout は JSON-RPC 専用）。`_meta.io.modelcontextprotocol/logLevel` が来た要求にのみ `notifications/message` を出す実装も可だが、既定では出さない |
| 10 | **Roots / Sampling の非推奨**。ファイルはツール引数・リソース URI・サーバ設定で渡す | 仮定 A3 の裏付け | 本設計は元から**ワークスペースを読まない**。成果物は `artifact_commit.content` として引数で渡す。Roots にも Sampling にも依存しない（判定は純粋な閾値計算で、LLM 呼び出しを含まない） |
| 11 | **Tasks が公式拡張へ分離**（`io.modelcontextprotocol/tasks`）。`tasks/get` ポーリング方式 | 長時間処理の扱い | **使わない**。本サーバの各ツール呼び出しはローカル I/O のみで即座に返る（コマンド実行をしない・仮定 A4）。長いのは「ループ全体」であって個々の呼び出しではない。ループの進行は `round` と `state` という**永続状態**で表現しており、タスクハンドルの二重管理を避ける |
| 12 | HTTP POST に `Mcp-Method` / `Mcp-Name` ヘッダ必須、`x-mcp-header` でツール引数からヘッダ生成 | streamable-http 版 | 標準ヘッダはクライアントが付ける。サーバは受理するだけ。`x-mcp-header` は**使わない**（Agent Plugins 1.0.0 側でヘッダに資格情報を置かない方針と整合、§9.4） |
| 13 | エラーコード割り当て方針: `-32000`〜`-32019` が実装定義、`-32020`〜`-32099` は仕様予約 | `E_*` の JSON-RPC 表現 | `E_*` は**ツール結果の `structuredContent.error.code`**（文字列）として返すのが既定で、JSON-RPC エラーにはしない（ツールの業務エラーであり、プロトコルエラーではないため）。プロトコル層で返す必要がある場合のみ `-32602`（不正引数）と `-32022`（版不一致）を使い、実装定義域 `-32000`〜`-32019` を新設しない |
| 14 | HTTP+SSE transport が **Deprecated** に再分類 | §9.5 の判断 | 元から legacy SSE 非依存。この改訂で判断が追認された形 |

### 18.2 「ステートレスになった」ことと本設計の関係

改訂が消したのは**プロトコルの状態**（接続に紐づくセッション、ハンドシェイク、ストリーム再開）であって、**アプリケーションの状態**ではない。仕様は後者について「サーバが発行したハンドルを通常のツール引数として渡せ」と明示的に道を示している（SEP-2567）。

本設計はまさにその形であり、改訂と**方向が一致している**:

| 観点 | 本設計 |
|---|---|
| 接続に状態を置くか | **置かない**。接続が切れても、プロセスが落ちても、ホストが変わっても、`session_id` があれば同じ状態に戻る |
| 状態はどこにあるか | `PLUGIN_DATA` 上のファイル（§8.1）。プロトコルにもメモリにも無い |
| ハンドルの発行者 | **サーバ**（ULID）。クライアントが好きな id を主張できない |
| リクエストの独立性 | 各ツール呼び出しは自己完結。`session_id` + `expected_round` + `submission_id` だけで解釈が確定する |
| 再送の安全性 | `submission_id` による冪等性 + `expected_round` による楽観ロックの二重防御 |
| ステートレス化で壊れたか | 壊れない。むしろ**プロトコルセッションに依存していたら、この改訂で全滅していた**。永続層に状態を置く設計だったため影響が局所（ハンドルの発行元と冪等キーの追加のみ）で済んだ |

### 18.3 MRTR による人間承認（`escalate` の強化）

MRTR（§18.1 の #5）は、`escalate` の人間承認に直接使える。ただし**クライアントが対応していない場合があるので、既存のトークンファイル方式を残した二段構え**にする。

```
escalate(action:"request_human") を受けたサーバ:

  クライアントが MRTR に対応（_meta の clientCapabilities で判別）
    → resultType:"input_required" を返す
       inputRequests:[{ type:"elicitation",
                        message:"3周スコアが動きません。continue / accept_as_is / abort を選んでください",
                        schema:{ resolution:enum, note:string } }]
       requestState には escalation_id を入れる（MRTR ではサーバが自前の識別子を requestState に埋める）
    → 人間が答えると、クライアントが inputResponses を付けて同じ要求を再試行
    → サーバは resolution を適用し resultType:"complete" を返す。human_token は不要

  クライアントが MRTR 非対応
    → 従来どおり state:"ESCALATED" にして escalations/<id>.token を書き、
      人間が値を転記して escalate(action:"resolve", human_token:…) を呼ぶ
```

どちらの経路でも、監査 JSON の `escalations[]` には `{escalation_id, channel:"mrtr"|"token_file", resolution, resolved_at}` が残る。**承認の事実と経路が記録される**という保証は経路によらず同じ。

### 18.4 適合上の限界（正直に）

- **`server/discover` と `resultType` と `CacheableResult` は MCP SDK 層の責務**であり、本設計書はサーバ実装がそれらを満たすことを要求するに留まる。ツール表面（§6）はその上に乗る。
- **2025-11-25 以前のクライアント**は `server/discover` を呼ばず、`resultType` を省略した結果を返す実装と話す。サーバは両リビジョンを受理する（`protocolVersions` に両方を広告）が、**旧クライアントでは MRTR 経路が使えない**のでトークンファイル方式に落ちる（§18.3）。ここは縮退であり、判定の厳密さは変わらない。
- **Agent Plugins 1.0.0 は MCP のリビジョンを規定していない**（`mcp.json` は transport と起動方法だけを宣言する）。したがって「どのリビジョンで話すか」は**クライアント任せ**であり、本設計はそこに依存しない。両リビジョンで同じツール表面・同じ判定になるように作ってある。


---

## 19. 3モード拡張（design → plan → implement）

§0–§18 は「1つの成果物を1つの rubric で収束させる」単一ループを定義した。本章はそれを **3モードの連鎖**に拡張する。既存の決定は覆さない（覆した箇所は §20 改訂履歴に列挙）。

### 19.1 モードの定義

| 項目 | `design` | `plan` | `implement` |
|---|---|---|---|
| **入力** | `task`（要求文）のみ。上流は持たない | 確定した design 成果物（親ハンドル + ダイジェスト） | 確定した plan 成果物（親ハンドル + ダイジェスト） |
| **成果物** | 設計書1本 | 実装計画1本 | 実装（コードとテストのファイル集合） |
| **成果物の型** `artifact_kind` | `markdown`（`content` 文字列） | `plan`（`content` に JSON。サーバが §19.5.2 のスキーマで検証） | `fileset`（`files[]` マニフェスト。§19.5.3） |
| **合格の意味** | 実装者が**追加の設計判断なしに**計画を書ける状態 | 全タスクが依存順に並び、各タスクに受け入れ条件と検証コマンドがある状態 | 全タスクが `done`、全テストが green、計画外の変更が無い状態 |
| **上流ピン** | 不可（`E_UPSTREAM_NOT_ALLOWED`） | 必須（`E_UPSTREAM_REQUIRED`） | 必須（`E_UPSTREAM_REQUIRED`） |
| **上流のモード** | — | `design` のみ | `plan` のみ |
| **既定 rubric プリセット** | `presets/design.json`（15基準・auto 3 / manual 12） | `presets/plan.json`（8基準・auto 4 / manual 4） | `presets/implement.json`（9基準・auto 7 / manual 2） |
| **`pass_score`** | 9 | 9 | 9 |
| **`pass_weighted_mean`** | 9.0 | 9.0 | 9.0 |
| **`max_rounds`** | 12 | 8 | 16 |
| **`stall_window`** | 3 | 2 | 4 |
| **`stall_epsilon`** | 0.25 | 0.25 | 0.20 |
| **`max_score_jump`** | 3 | 3 | 3 |
| **`require_command_evidence_for`** | `["auto"]` | `["auto"]` | `["auto"]` + `command` 根拠に `target_digest` 必須（§19.8） |
| **モード固有の必須引数** | — | `content` が plan スキーマに適合 | `files[]` と `test_inventory` |

**閾値をモードで変えた理由**

| 値 | 理由 |
|---|---|
| `plan.max_rounds = 8` | 設計が確定している以上、探索空間は設計モードより狭い。8周で収束しないのは「設計が決まっていない」信号であり、周回を増やすより差し戻し（§19.4）が正しい |
| `plan.stall_window = 2` | 同上。計画は文章量が少なく1周の情報量が大きいので、2周動かなければ本質的に詰まっている |
| `implement.max_rounds = 16` | テスト環境・依存関係・フレーキーな失敗など**外部要因で足踏みする**周が入る。12 では正常な作業が打ち切られる |
| `implement.stall_window = 4` | 同上。リファクタ周は一時的にスコアが伸びない |
| `implement.stall_epsilon = 0.20` | 自動検証比率が高く加重平均が階段状に動くため、0.25 では小さな前進を「停滞」と誤検知する |

`pass_score` を全モード 9 に揃えたのは意図的である。**モードによって合格の厳しさを変えない**（緩めたいときは rubric の基準そのものを議論すべきで、閾値をいじるのは §5.3 の `policy_change` として禁止されている）。

### 19.2 連鎖の機構（上流ピン）

#### 19.2.1 チェーンとピン

- `loop_open(mode:"design")` は **チェーン ID** `chain_id`（ULID、`ch_` 前置）を採番する。
- `loop_open(mode:"plan"|"implement")` は `upstream:{session_id, artifact_digest}` を**必須**で受け取り、`chain_id` を上流から継承する。
- サーバは受理前に次を全て検査する。1つでも欠ければセッションは作られない。

| 検査 | 失敗時 |
|---|---|
| 上流セッションが存在する | `E_UPSTREAM_NOT_FOUND` |
| 上流の `state` が `FINAL` または `FINAL_WITH_RELAXATION` | `E_UPSTREAM_NOT_FINAL`（`detail.upstream_state` を返す） |
| 上流の `mode` が期待どおり（plan←design / implement←plan） | `E_UPSTREAM_MODE_MISMATCH` |
| 渡された `artifact_digest` が上流の**確定成果物**と一致 | `E_UPSTREAM_DIGEST_MISMATCH`（`detail.expected` に正しい digest） |
| 上流が既に別セッションにピンされていても可（分岐は許可） | — |

受理されると `session.json` に次が固定される。

```json
{
  "chain_id": "ch_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
  "mode": "plan",
  "upstream": {
    "session_id": "rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
    "mode": "design",
    "artifact_digest": "sha256:9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4",
    "verdict": "FINAL",
    "pinned_at": "2026-09-04T11:20:00Z"
  }
}
```

**「下流は上流の版を知らないまま開始できない」ことの担保**: `upstream.artifact_digest` は `loop_open` の必須引数であり、正しい値でなければセッションが作られない。digest を知るには上流の `loop_state` か `audit_export` を通るしかない。モデルが「設計を読んだつもり」で計画を書き始める経路が構造的に存在しない。

#### 19.2.2 上流本文の供給

下流セッションの `loop_state` は `include:["upstream"]` で**上流成果物の全文**（またはヘッダ）を返す。上流の本文は下流の `PLUGIN_DATA` から読めるので、**モデルのコンテキストが空でも上流を読み直せる**（F3 と同じ理屈をチェーンに拡張したもの）。

#### 19.2.3 上流を参照する根拠 `kind:"upstream"`

下流の採点では、「設計のこの決定に対応してこう計画した」という根拠が必要になる。そこで evidence に3つ目の種類を足す。

```json
{
  "kind": "upstream",
  "upstream_locator": "§7.2 既定値と根拠",
  "excerpt": "max_rounds | 12 | 実測で 8–10 周で収束するタスクが多く"
}
```

サーバは `excerpt` が**ピンされた上流成果物**に（正規化後）存在することを検証する。無ければ `E_EVIDENCE_NOT_FOUND`。これは §19.3 の部分再検証を機械的に決めるための土台でもある。

### 19.3 上流変更による下流の失効

#### 19.3.1 上流はどうやって変わるのか

`FINAL` は終端なので、上流が変わる経路は**明示的な再オープンのみ**である。

- `escalate(action:"reopen", human_token)` — 上流自身の人間が開け直す。
- `escalate(action:"kickback", human_token)` — 下流からの差し戻し（§19.4）。

どちらも `human_token` を要求し、`state` を `FINAL` → `DRAFTING`（`round += 1`）に戻し、`session.reopened[]` に `{at, by, reason, previous_final_digest}` を積む。**黙って上流が変わることはない。**

#### 19.3.2 失効の検出

サーバは下流セッションの**全ツール呼び出しの入口**（`loop_state` を含む）で、ピンした digest と上流の現在の確定 digest を比較する。

```text
upstream_current = 上流が FINAL 系なら その確定 digest / FINAL でなければ null

if upstream_current == pinned_digest:      正常。何もしない
elif 上流が FINAL でない（再オープン中）:   下流を FROZEN にする（reason: upstream_reopened）
elif upstream_current != pinned_digest:     下流を SUPERSEDED にする（reason: upstream_drift）
elif 上流が消えている:                      下流に orphan フラグ。FINAL 到達不能（§19.3.5）
```

- 下流が `FINAL` だった場合も**容赦なく `SUPERSEDED` に落ちる**。「古い設計に対して合格していた実装」が合格のまま残る経路は無い。
- `SUPERSEDED` / `FROZEN` で呼べるのは `loop_state` / `escalate` / `audit_export` のみ（§19.9）。

#### 19.3.3 部分再検証で済ませる条件

全部を採点し直すのは高コストで、実際には上流の変更が一部の基準にしか影響しないことが多い。そこで **`escalate(action:"rebase", upstream_digest)`** が次を機械的に計算する。

```text
rebase(new_upstream_digest):
  1. 新しい上流本文を取得
  2. 直前に受理された提出の各基準について、その基準が持つ
     kind:"upstream" の evidence を全て新しい本文に対して再照合する
  3. 分類:
       - upstream 根拠を1つも持たない基準            → carry_over（点数を持ち越す）
       - upstream 根拠を持ち、全て新本文に存在する     → carry_over
       - upstream 根拠のうち1つでも新本文に無い       → invalidated（previous_score を null にする）
  4. invalidated が1つでもあれば state = DRAFTING、round += 1、
     must_fix = invalidated（アンカー全文つき）
     invalidated が0なら state = DRAFTING、round は据え置き、
     next_action は artifact_commit（上流の変更が下流に影響しなかったことの確認提出）
  5. session.upstream.artifact_digest を新しい値に更新し、
     rebases[] に {at, from_digest, to_digest, invalidated[], carried_over[]} を記録
```

**「影響が無かった」場合でも1回は提出させる**（4 の後半）。上流が変わったのに下流が一度も動かずに `FINAL` を保つと、監査で「本当に確認したのか」が判別できないため。ここは意図的にコストを払う。

`invalidated` になった基準は `previous_score = null` なので、§7.1 手順 6.5 によりインフレ・ジャンプ・新規性の検査がスキップされる。**再検証は「初めて採点する」のと同じ扱い**になり、ごまかしの余地が増えない。

#### 19.3.4 失効から復帰するまでの手順（下流視点）

```
何かツールを呼ぶ → state:"SUPERSEDED", upstream_drift:{pinned, current, upstream_diff_summary}
  ↓
loop_state{include:["upstream","must_fix"]}   ← 新しい上流本文を読む
  ↓
escalate{action:"rebase", upstream_digest:<current>, note:"…"}
  ↓
state:"DRAFTING" + invalidated 基準が must_fix に載る
  ↓
artifact_commit → score_submit → サーバが判定
```

#### 19.3.5 上流セッションが消えていた場合

`PLUGIN_DATA` の破損、手動削除、`EPHEMERAL` モードでのプロセス終了などで上流が読めないことがある。

| 状況 | 挙動 |
|---|---|
| 上流ディレクトリが無い | 下流は動き続けるが `orphan:true`。`warnings` に `upstream_missing`。**`FINAL` は出ず `ESCALATED（upstream_missing）`** になる |
| 上流の `session.json` はあるが成果物ファイルが無い | 同上。ピン検証ができないため `orphan` 扱い |
| 復旧手段 | 上流の `audit_export`（`include_artifacts:true`）を持っていれば、`escalate(action:"rebase", upstream_digest:…, upstream_content:…)` で**本文ごと再投入**できる。本文の digest が `upstream_digest` と一致しなければ `E_UPSTREAM_DIGEST_MISMATCH` |

つまり **監査 JSON がバックアップを兼ねる**。これは §12 の監査可能性が運用上も効くという設計上の狙いである。

### 19.4 差し戻し（下流 → 上流）

実装中に設計の欠陥が見つかる、は現実に起きる。握りつぶす（下流で辻褄を合わせる）と、設計書と実装が乖離したまま両方 `FINAL` になる。これを塞ぐ。

```
escalate{action:"kickback", note:"<欠陥の説明。40文字以上>", human_token, target_criteria:[...]}
```

| 対象 | 効果 |
|---|---|
| 上流セッション | `FINAL` → `DRAFTING`（`round += 1`）。`must_fix` に `target_criteria` が積まれる。`reopened[]` に `{by:"kickback", from_session:<下流ハンドル>, note}` |
| 下流セッション | `FROZEN`（`reason:"kicked_back"`）。**破棄しない**。成果物も評価履歴もそのまま残る |
| チェーン | `chain.json` の `kickbacks[]` に記録 |

**下流を凍結にした理由（破棄・部分継続との比較）**

| 選択肢 | 採らなかった理由 |
|---|---|
| 破棄 | 実装の大半は設計変更と無関係なことが多く、捨てるのは高コスト。監査の連続性も切れる |
| 部分継続（凍結せず作業続行） | 上流が動いている最中に下流が進むと、どの上流版に対する成果物なのかが定義できなくなる。ピンの意味が消える |
| **凍結（採用）** | 作業は保存され、上流が再確定した時点で `SUPERSEDED` → `rebase` に自然に合流する。§19.3.3 の部分再検証がそのまま使えるので、無関係な基準は持ち越せる |

**`FROZEN` からの経路**

```
FROZEN ──(上流が再び FINAL になった)──▶ 次のツール呼び出しで SUPERSEDED ──rebase──▶ DRAFTING
FROZEN ──escalate{action:"abort"}──▶ ABORTED（下流を捨てる判断。人間が明示する）
```

`FROZEN` 中に `artifact_commit` / `score_submit` を呼ぶと `E_STATE_VIOLATION`（`detail.reason:"frozen_by_kickback"`, `detail.upstream_session_id`）。**上流が直っていないのに下流だけ進める経路が無い。**

### 19.5 成果物の型

#### 19.5.1 判断: 単一文字列 `content` では足りない

- `design`: 足りる。Markdown 1本は文字列で表現でき、`locator` 根拠の照合も文字列検索で完結する。**変更しない。**
- `plan`: 文字列でも表現できるが、**タスクの依存関係が機械検査できない**（循環参照・孤立タスク・受け入れ条件の欠落を検出できない）。→ **JSON 化して型を与える**（§19.5.2）。
- `implement`: 足りない。複数ファイルの集合であり、単一文字列に押し込むと (a) 1MB 上限を容易に超え、(b) ファイル単位の差分が取れず、(c) テスト資産の増減が見えない。→ **マニフェスト方式に拡張**（§19.5.3）。

#### 19.5.2 `artifact_kind: "plan"` — 計画の型

`content` は次のスキーマに適合する JSON 文字列でなければならない。適合しなければ `E_PLAN_SCHEMA`（`detail.path` / `detail.reason`）。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agent-plugins.org/x/rubric-loop/v1/plan.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["plan_version", "summary", "tasks"],
  "properties": {
    "plan_version": { "type": "integer", "minimum": 1 },
    "summary": { "type": "string", "minLength": 40, "maxLength": 4000 },
    "assumptions": { "type": "array", "items": { "type": "string", "maxLength": 1000 } },
    "tasks": {
      "type": "array", "minItems": 1, "maxItems": 200,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "title", "intent", "design_refs", "depends_on", "changes", "acceptance", "verify"],
        "properties": {
          "id": { "type": "string", "pattern": "^T[0-9]{3}$" },
          "title": { "type": "string", "minLength": 1, "maxLength": 200 },
          "intent": { "type": "string", "minLength": 20, "maxLength": 2000 },
          "design_refs": {
            "type": "array", "minItems": 1,
            "items": { "type": "string", "minLength": 1, "maxLength": 200 },
            "description": "上流設計書の節番号や見出し。plan モードでは required かつ 1件以上を必須にし、設計に無い作業が紛れ込むのを防ぐ（F18）"
          },
          "depends_on": {
            "type": "array", "uniqueItems": true,
            "items": { "type": "string", "pattern": "^T[0-9]{3}$" }
          },
          "changes": {
            "type": "array", "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["path", "kind"],
              "properties": {
                "path": { "type": "string", "minLength": 1, "maxLength": 1024 },
                "kind": { "enum": ["add", "modify", "delete"] },
                "note": { "type": "string", "maxLength": 500 }
              }
            }
          },
          "acceptance": {
            "type": "array", "minItems": 1,
            "items": { "type": "string", "minLength": 10, "maxLength": 1000 },
            "description": "そのタスクが完了したと言える条件。人間が読んで真偽が判定できる文であること"
          },
          "verify": {
            "type": "array", "minItems": 1,
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["command", "expect_exit_code"],
              "properties": {
                "command": { "type": "string", "minLength": 3, "maxLength": 1000 },
                "expect_exit_code": { "type": "integer", "minimum": -256, "maximum": 255 },
                "note": { "type": "string", "maxLength": 500 }
              }
            }
          },
          "estimate_rounds": { "type": "integer", "minimum": 1, "maximum": 10 }
        }
      }
    }
  }
}
```

**サーバがスキーマ適合に加えて機械検査すること**（いずれも `E_PLAN_INVALID`、`detail` に該当 id）:

| 検査 | 目的 |
|---|---|
| `id` の一意性 | 参照の曖昧さを消す |
| `depends_on` の参照先が実在する | 幽霊依存の排除 |
| 依存グラフに**循環が無い**（トポロジカルソート可能） | 実行不能な計画の排除 |
| 到達不能タスクが無い（依存の島が1つ、または `depends_on:[]` が複数あっても全体が有向非巡回で並べられる） | 孤立タスクの排除 |
| 全タスクに `acceptance` が1件以上、`verify` が1件以上 | 「検証できない計画」の排除 |
| `design_refs` の各文字列が**ピンされた上流設計書に存在する**（正規化後の部分一致） | **設計に無い作業の混入を機械的に弾く**。存在しなければ `E_PLAN_DESIGN_REF`（`detail.task_id`, `detail.ref`） |

最後の1件が効く。「設計に書いていない機能を計画に足す」という典型的な逸脱が、`E_PLAN_DESIGN_REF` で自動的に止まる。

**`design_refs` を持たないタスクは合法ではない**。`design_refs` は task の `required` に含まれるので、欠落・空配列（`minItems:1` 違反）はスキーマ段階で `E_PLAN_SCHEMA`（`detail.path:"/tasks/<i>/design_refs"`, `detail.reason:"required"` または `"min_items"`）となり、上表の機械検査（`E_PLAN_INVALID` / `E_PLAN_DESIGN_REF`）まで到達しない。すなわち、**欠落はスキーマ違反、実在しない参照は `E_PLAN_DESIGN_REF`** と役割が分かれる。F18 は「全タスクに `design_refs` を必須化」と述べており、この配置がその要求そのものである。

計画の人間向け Markdown が欲しい場合は `files[]` に併記してよい（`artifact_kind:"plan"` でも `files` は任意で受け付ける）。ただし**判定対象は JSON のみ**であり、Markdown は監査用の添付である。

#### 19.5.3 `artifact_kind: "fileset"` — 実装の型

`content` の代わりに `files[]` を渡す。サーバはワークスペースを読まない（仮定 A3）ので、**ハッシュはモデルが計算して申告する**。サーバが担保するのは「申告の内部整合性」と「再現手順が記録されていること」であり、ハッシュの真正性そのものではない（限界は §19.8.4 に明記）。

```json
{
  "files": [
    { "path": "server/main.js",            "sha256": "0f3a…", "bytes": 18422, "role": "source" },
    { "path": "server/state.js",           "sha256": "b71c…", "bytes":  9310, "role": "source" },
    { "path": "test/score_submit.test.js", "sha256": "c904…", "bytes":  7755, "role": "test" },
    { "path": "package.json",              "sha256": "51de…", "bytes":   812, "role": "config" }
  ],
  "manifest_command": "git ls-files -z | xargs -0 sha256sum | sort -k2",
  "manifest_output_sha256": "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"
}
```

- **マニフェスト digest の取り方**: 各 `files[i]` を `"<sha256>  <path>\n"` の1行に正規化し、`path` の昇順（UTF-8 バイト順）で連結した文字列の SHA-256。これが `artifact.digest` になる。**改行コードやキー順の揺れで digest が変わらない**ように正規化を固定する。
- **上限**: `files` は最大 5000 件、`path` は 1024 バイト、マニフェスト全体で 2 MB。個々のファイル本文はサーバに送らない（送れば 1 MB 制限に当たるうえ、ワークスペースの二重管理になる）。
- **`role`**: `source` / `test` / `config` / `doc` / `generated`。`test` の増減が §19.8 の検査に使われる。
- **`manifest_command` と `manifest_output_sha256`**: マニフェストを再現するコマンドとその出力ハッシュ。第三者が同じコマンドを回して `files[]` を再構成できる。**必須**（欠けると `E_MANIFEST_UNVERIFIABLE`）。

`unchanged` の判定・`E_SCORE_INFLATION`・`diff.changed_ratio` は、マニフェスト digest とファイル単位の差分（追加/削除/変更ファイル数）で従来どおり動く。`fileset` の `diff` は次を返す。

```json
{
  "added_files": 2, "removed_files": 0, "modified_files": 5,
  "added_lines": null, "removed_lines": null, "changed_ratio": 0.18
}
```

行数はサーバが本文を持たないので `null`。`changed_ratio` は「変化したファイル数 / 全ファイル数」で定義する（`markdown` の行ベース定義とは別式であることを明記する）。

### 19.6 ツール表面（3モード対応後）

#### 19.6.1 結論: **新規ツールは1本も追加しない**

3モード化で必要になった機能は、すべて既存7ツールの引数追加で表現できた。以下は「追加を検討して却下した」記録である（この記録が無いと、後から誰かが安易に足す）。

| 足そうとした機能 | 検討したツール名 | 却下理由（＝どの既存ツールの引数で足りるか） |
|---|---|---|
| 下流セッションの開始と上流の紐付け | `chain_link` | `loop_open` は「セッションを作る」ツールであり、上流ピンは**作成時の属性**でしかない。`upstream` 引数で表現でき、別ツールにすると「リンク前のセッション」という中途半端な状態が生まれて状態機械が増える |
| 上流の変更を下流に取り込む | `chain_rebase` | rebase は「ループの通常進行から外れた復帰操作」であり、`escalate` の定義（＝正常フローから外れる判断を記録つきで行う）にそのまま当てはまる。`action:"rebase"` で表現できる |
| 実装の差し戻し | `chain_kickback` | 同上。`action:"kickback"` |
| 上流成果物の取得 | `upstream_fetch` | `loop_state` は「今このセッションについて知るべきことを返す」ツール。上流本文はその一部。`include:["upstream"]` で表現でき、別ツールにすると「どちらで読むべきか」の判断がモデルに増える |
| 計画の妥当性検査（循環依存など） | `plan_validate` | 検査は `artifact_commit` の**受理条件**であるべきで、独立ツールにすると「検査せずに提出する」経路が生まれる。受理時に必ず走る形が正しい |
| テスト台帳の登録 | `test_report` | テスト台帳は成果物の属性（どのファイルにどのテストがあるか）であり、提出と分離すると台帳と成果物が食い違う。`artifact_commit.test_inventory` で原子的に扱う |

**判断基準を明文化する**: 新規ツールが正当化されるのは「(a) 既存7ツールのどの目的にも属さず、(b) 引数追加では表現できず（＝既存ツールの前提条件・状態遷移と両立しない）、(c) それ自身が独立した状態遷移を持つ」場合のみ。上の6件はいずれも (a) か (b) で落ちる。

#### 19.6.2 全ツール一覧（3モード対応後）

`tools/list` の固定順は**変えない**（§18.1 #7 と整合）。

| # | name | 目的 | 主な入力 | 主な出力 | 3モードでの差分 |
|---|---|---|---|---|---|
| 1 | `loop_open` | セッションを開く／再開する | `loop_mode`（新設。既存の `mode` は `create`/`resume` のままで意味を変えない）、`upstream`、`rubric_preset`、`submission_id` を追加 | `chain_id`, `loop_mode`, `upstream` を追加 | **引数追加のみ**（`submission_id` の必須化は §20.2 C1） |
| 2 | `loop_state` | 現在の状態・must_fix・rubric・上流を返す | `include` に `"upstream"` / `"chain"` を追加 | `upstream_artifact`, `chain` を追加 | **引数追加のみ** |
| 3 | `artifact_commit` | 成果物を提出する | `files`, `manifest_command`, `manifest_output_sha256`, `test_inventory` を追加。`content` と `files` は `oneOf` | `diff` が `fileset` 用の形も返す | **引数追加のみ** |
| 4 | `score_submit` | 自己採点を提出し、判定を受ける | evidence に `kind:"upstream"` 追加、`kind:"command"` に `target_digest` 追加 | 変更なし | **引数追加のみ** |
| 5 | `rubric_amend` | rubric を改訂する | `submission_id` を追加（冪等性の統一） | 変更なし | **引数追加のみ** |
| 6 | `escalate` | 正常フロー外の判断を記録して行う | `action` に `reopen` / `rebase` / `kickback` を追加。`upstream_digest`, `upstream_content`, `target_criteria`, `submission_id` を追加 | `rebase_result` を追加 | **引数追加のみ** |
| 7 | `audit_export` | 監査 JSON を出す | `scope:"session"\|"chain"` を追加 | `chain` スコープでは連鎖全体 | **引数追加のみ** |

**互換性についての明示的な決定**: 既存 `loop_open` の `mode`（`create`/`resume`/`create_or_resume`）と、新しいモード（`design`/`plan`/`implement`）は**別の概念**である。同じ名前を使い回すと意味が壊れるので、既存の `mode` は名前を維持し、新概念は **`loop_mode`** という別フィールドにした（§20 の「変えなかったこと」に該当）。

#### 19.6.3 `loop_open` の差分

**改訂後の入力スキーマの実物は §6.4.1 にある。** 同じスキーマを2箇所に置くと片方だけ直す事故が起きるので、本書ではツールの実物（入力／出力／エラー条件）は §6.4 に**1箇所だけ**置く。この節は「3モード化で何が変わったか」だけを書く。

| 追加/変更 | フィールド | 内容 |
|---|---|---|
| 追加 | `loop_mode` | `design` / `plan` / `implement`。`mode:"create"` で必須、作成後は不変 |
| 追加 | `upstream` | `{session_id, artifact_digest}` の上流ピン。plan/implement で必須、design で禁止 |
| 追加 | `rubric_preset` | `design` / `plan` / `implement`。`rubric` と併記された場合は `rubric` が優先し `warnings:["preset_overridden"]` を返す |
| 追加 | `submission_id` | 冪等キー。**必須**（変更の理由と移行手順は §20.2 C1） |
| 変更 | `required` | `["mode"]` → `["mode","submission_id"]` |
| 追加 | `allOf` 分岐 | ① `create` ⇒ `task`+`loop_mode` 必須・`session_id` 禁止 ② `resume` ⇒ `session_id` か `label` のいずれか必須 ③ `plan`/`implement` ⇒ `upstream` 必須 ④ `design` ⇒ `upstream` 禁止 |
| 追加 | 出力 | `chain_id` / `loop_mode` / `upstream`（解決後の上流の state と digest） |
| 追加 | エラー | `E_UPSTREAM_REQUIRED` / `E_UPSTREAM_NOT_ALLOWED` / `E_UPSTREAM_NOT_FOUND` / `E_UPSTREAM_NOT_FINAL` / `E_UPSTREAM_MODE_MISMATCH` / `E_UPSTREAM_DIGEST_MISMATCH` / `E_CHAIN_BUDGET_EXHAUSTED` |

`rubric` も `rubric_preset` も無い `mode:"create"` は `E_VALIDATION`（`detail.reason:"rubric_or_preset_required"`）。`artifact_kind` の既定は `loop_mode` から決まる（design→`markdown`、plan→`plan`、implement→`fileset`）。異なる組み合わせを明示指定することは許すが（例: plan を Markdown で書く）、その場合 §19.5.2 の機械検査は走らないため `warnings:["plan_schema_checks_disabled"]` を返す。

#### 19.6.4 `artifact_commit` の差分

**改訂後の入力スキーマの実物は §6.4.3 にある。**

| 追加/変更 | フィールド | 内容 |
|---|---|---|
| 変更 | 本文の渡し方 | `content` 単独必須 → `content` と `files` の `oneOf`（変更の理由と移行手順は §20.2 C3） |
| 追加 | `files[]` | `{path, sha256, bytes, role}`。`role` は `source`/`test`/`config`/`doc`。最大5000件・パス1024バイト |
| 追加 | `manifest_command` / `manifest_output_sha256` | マニフェストを作った再実行可能なコマンドと、その出力のハッシュ。`files` を使うとき必須 |
| 追加 | `test_inventory` | `{source_command, source_exit_code, counts, tests[], removed_tests[], diffs[]}`。`fileset` で必須 |
| 追加 | 出力 `artifact.diff` | `fileset` では `added_files`/`removed_files`/`changed_files`/`changed_ratio`（ファイル件数ベース。定義は §19.5.3） |
| 追加 | エラー | `E_ARTIFACT_KIND_MISMATCH` / `E_MANIFEST_UNVERIFIABLE` / `E_TEST_INVENTORY_REQUIRED` / `E_TEST_MUTATED_WITHOUT_DIFF` / `E_PLAN_SCHEMA` / `E_PLAN_INVALID` / `E_PLAN_DESIGN_REF` / `E_FROZEN` / `E_SUPERSEDED` |

`artifact_kind:"fileset"` のセッションに `content` を渡すと `E_ARTIFACT_KIND_MISMATCH`。逆も同じ。`artifact_kind:"fileset"` で `test_inventory` が無ければ `E_TEST_INVENTORY_REQUIRED`。

#### 19.6.5 `score_submit` / `rubric_amend` / `escalate` / `audit_export` の差分

**改訂後の入力スキーマの実物は §6.4.4 / §6.4.5 / §6.4.6 / §6.4.7 にある。**

| ツール | 追加/変更 | 内容 |
|---|---|---|
| `score_submit` | 追加 | 根拠に3つ目の分岐 `kind:"upstream"`（`upstream_locator` + `excerpt`）。上流の確定成果物を根拠にできる。design モードで使うと `E_UPSTREAM_NOT_ALLOWED` |
| `score_submit` | 追加 | `kind:"command"` に `target_digest`（そのコマンドを実行した対象のマニフェスト digest）。implement モードでは必須で、現在の digest と違えば `E_EVIDENCE_TARGET` |
| `score_submit` | 追加 | エラー `E_TEST_REGRESSION` / `E_TEST_NOT_GREEN` / `E_EVIDENCE_TARGET` / `E_FROZEN` / `E_SUPERSEDED` / `E_CHAIN_BUDGET_EXHAUSTED` |
| `rubric_amend` | 追加 | `submission_id`（**必須**。§20.2 C2） |
| `escalate` | 追加 | `action` に `reopen` / `rebase` / `kickback`。`upstream_digest` / `upstream_content` / `target_criteria` / `submission_id` |
| `escalate` | 追加 | 出力 `rebase_result`（`carried_over` / `must_reverify` / `new_round`） |
| `audit_export` | 追加 | `scope:"session"\|"chain"`。`chain` では `audit_version:2` の連鎖監査 JSON（§19.13.2） |

`rebase` が `human_token` を要求しない理由: rebase は**現在の合格を下げる方向の操作**であり、それ自体では何も緩まない。再確認の提出と採点は必ず通る（§19.3.3 手順4）。一方 `reopen` / `kickback` は**すでに出た FINAL を覆す**ので人間の承認を要る側に置いた。

#### 19.6.6 追加エラーコード

| code | 発生条件 | 返す `detail` |
|---|---|---|
| `E_UPSTREAM_REQUIRED` | `loop_mode` が plan/implement なのに `upstream` が無い | `loop_mode` |
| `E_UPSTREAM_NOT_ALLOWED` | `loop_mode:"design"` に `upstream` を渡した | — |
| `E_UPSTREAM_NOT_FOUND` | 上流ハンドルが存在しない | `session_id` |
| `E_UPSTREAM_NOT_FINAL` | 上流が FINAL 系でない | `upstream_state` |
| `E_UPSTREAM_MODE_MISMATCH` | plan←design / implement←plan の関係でない | `expected`, `actual` |
| `E_UPSTREAM_DIGEST_MISMATCH` | ピン指定の digest が上流の確定成果物と違う | `expected`, `actual` |
| `E_PLAN_SCHEMA` | `artifact_kind:"plan"` の `content` が JSON として不正 or スキーマ不適合 | `path`, `reason` |
| `E_PLAN_INVALID` | 循環依存・幽霊依存・id 重複・acceptance/verify 欠落 | `check`, `task_id` |
| `E_PLAN_DESIGN_REF` | `design_refs` の参照先が上流設計書に存在しない | `task_id`, `ref` |
| `E_ARTIFACT_KIND_MISMATCH` | `content`/`files` がセッションの `artifact_kind` と食い違う | `artifact_kind` |
| `E_MANIFEST_UNVERIFIABLE` | `fileset` で `manifest_command` / `manifest_output_sha256` が欠落 | — |
| `E_TEST_INVENTORY_REQUIRED` | `fileset` で `test_inventory` が無い | — |
| `E_TEST_REGRESSION` | テスト総数減 or skipped 増 を申告なしに行い、かつスコアが上がった | `prev`, `now`, `raised_criteria` |
| `E_TEST_MUTATED_WITHOUT_DIFF` | テストファイルの sha256 が変わったのに `test_inventory.diffs` に該当ファイルの差分が無い | `files` |
| `E_TEST_NOT_GREEN` | `counts.failed > 0` または `source_exit_code != 0` なのに、auto 基準に 9 以上を付けた | `criteria` |
| `E_EVIDENCE_TARGET` | implement モードの `command` 根拠に `target_digest` が無い、または現在のマニフェスト digest と不一致 | `expected`, `actual` |
| `E_CHAIN_BUDGET_EXHAUSTED` | チェーン合計周回が `chain_max_rounds` を超えた | `chain_rounds`, `limit` |
| `E_FROZEN` | `FROZEN` 中に `artifact_commit`/`score_submit` を呼んだ | `upstream_session_id` |
| `E_SUPERSEDED` | `SUPERSEDED` 中に `artifact_commit`/`score_submit` を呼んだ | `pinned`, `current` |

いずれも §18.1 #13 に従い `structuredContent.error.code`（文字列）で返し、JSON-RPC エラーにはしない。

#### 19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）

3モード対応後の**確定した表面**。スキーマの実物は §6.4 にあり、この表はそこへの索引と、各ツールが返しうるエラーコードの**全数**である。

**「全数」の定義**（この表の読み方。ツール固有の追加分だけを挙げた表ではない）:

- 各行は、そのツールが返しうるコードを**§6.3 の共通エラー条件を含めて**すべて挙げる。共通だからといって省略しない。
- ただし `E_INTERNAL` だけは例外で、7ツール全部に一様に付くため行には書かず件数にも数えない。行末の件数は `E_INTERNAL` を除いた数である。
- したがって、入力 JSON Schema 違反として返る `E_VALIDATION` は **7ツール全部の行に現れる**。`score_submit` の `rationale` が 40 文字未満、`loop_state` の `include` が未知の値、といった入力不備はすべて `E_VALIDATION` であり、ツール固有のごまかし検出コード（`E_EVIDENCE_*` など）はスキーマを通過した入力に対してのみ発生する。
- 逆に、その状態機械上ありえないコードは書かない（例: 全状態で呼べる `loop_state` に `E_STATE_VIOLATION` は無い）。

| # | name | 目的 | 入力スキーマ | 出力スキーマ | 返しうるエラー（`E_INTERNAL` を除く全数） |
|---|---|---|---|---|---|
| 1 | `loop_open` | セッションを作成／再開し、rubric・policy・`loop_mode`・上流ピンを固定する | §6.4.1 | §6.4.1 | `E_VALIDATION`, `E_HANDLE_NOT_ACCEPTED`, `E_SESSION_NOT_FOUND`, `E_AMBIGUOUS_LABEL`, `E_NO_PERSISTENCE`, `E_RUBRIC_ON_RESUME`, `E_UPSTREAM_REQUIRED`, `E_UPSTREAM_NOT_ALLOWED`, `E_UPSTREAM_NOT_FOUND`, `E_UPSTREAM_NOT_FINAL`, `E_UPSTREAM_MODE_MISMATCH`, `E_UPSTREAM_DIGEST_MISMATCH`, `E_CHAIN_BUDGET_EXHAUSTED`（13件） |
| 2 | `loop_state` | 状態・rubric 全文・履歴・`must_fix`・上流・チェーンを返す。文脈が飛んだ時の唯一の復帰口 | §6.4.2 | §6.4.2 | `E_VALIDATION`, `E_SESSION_NOT_FOUND`（2件。全状態で呼べるので状態違反は起きない） |
| 3 | `artifact_commit` | 成果物（`content` または `files`）を登録し digest を確定して `SCORING` へ遷移する | §6.4.3 | §6.4.3 | `E_STATE_VIOLATION`, `E_CONCURRENT`, `E_VALIDATION`, `E_ADDRESS_MISSING`, `E_ARTIFACT_KIND_MISMATCH`, `E_MANIFEST_UNVERIFIABLE`, `E_TEST_INVENTORY_REQUIRED`, `E_TEST_MUTATED_WITHOUT_DIFF`, `E_PLAN_SCHEMA`, `E_PLAN_INVALID`, `E_PLAN_DESIGN_REF`, `E_FROZEN`, `E_SUPERSEDED`（13件） |
| 4 | `score_submit` | 全基準のスコアと根拠を提出する。**判定を返す唯一のツール** | §6.4.4 | §6.4.4 | `E_VALIDATION`, `E_STATE_VIOLATION`, `E_CONCURRENT`, `E_DIGEST_MISMATCH`, `E_INCOMPLETE_SCORES`, `E_EVIDENCE_REQUIRED`, `E_EVIDENCE_KIND`, `E_EVIDENCE_NOT_FOUND`, `E_EVIDENCE_STALE`, `E_EVIDENCE_TARGET`, `E_SCORE_INFLATION`, `E_SCORE_JUMP`, `E_WEAKNESS_REQUIRED`, `E_TEST_REGRESSION`, `E_TEST_NOT_GREEN`, `E_UPSTREAM_NOT_ALLOWED`, `E_FROZEN`, `E_SUPERSEDED`, `E_CHAIN_BUDGET_EXHAUSTED`（19件） |
| 5 | `rubric_amend` | rubric を新しい版として変更し、緩和方向の変更を監査に残す | §6.4.5 | §6.4.5 | `E_STATE_VIOLATION`, `E_CONCURRENT`, `E_THRESHOLD_IMMUTABLE`, `E_RELAXATION_UNACKNOWLEDGED`, `E_VALIDATION`（5件） |
| 6 | `escalate` | 正常フロー外の判断（人間呼び出し・解決・打ち切り・再開・rebase・差し戻し）を記録つきで行う | §6.4.6 | §6.4.6 | `E_STATE_VIOLATION`, `E_TOKEN_INVALID`, `E_RESOLUTION_NOT_APPLICABLE`, `E_VALIDATION`, `E_UPSTREAM_NOT_FOUND`, `E_UPSTREAM_DIGEST_MISMATCH`, `E_CHAIN_BUDGET_EXHAUSTED`（7件） |
| 7 | `audit_export` | 監査 JSON をセッション単位またはチェーン単位で書き出す | §6.4.7 | §6.4.7 | `E_SESSION_NOT_FOUND`, `E_VALIDATION`（`scope:"chain"` で `chain_id` を解決できない）（2件） |

**エラーコードの総数の突き合わせ**: 本書で定義されているコードは、§6.3 の共通6件 ＋ 各ツールの個別エラー表17件 ＋ §19.6.6 の3モード追加19件 ＝ **42件**。上の表に列挙したのべ件数は61で、差の20は複数ツールで共有されるコード（`E_VALIDATION` / `E_STATE_VIOLATION` / `E_CONCURRENT` / `E_SESSION_NOT_FOUND` / `E_UPSTREAM_*` / `E_FROZEN` / `E_SUPERSEDED` / `E_CHAIN_BUDGET_EXHAUSTED`）の重複である。重複を除くと41件で、これに全ツール共通の `E_INTERNAL` を足すと定義済み42件と一致する。**定義されているのに使われないコードも、使われているのに定義が無いコードも無い**（検査コマンドは §14.3.4）。

**この表が満たしている性質**:

1. **最小性** — 7本それぞれの目的が1文で書けており、2本を1本に統合しようとすると「目的」欄が2文になる（＝直交している）。逆に1本を2本に割ろうとすると、割った先が独立した状態遷移を持たない（§19.6.1 の判断基準）。
2. **完全性** — 名前・目的・入力スキーマ・出力スキーマ・エラー条件の5点が全ツールで埋まっている。空欄は無い。
3. **不変性** — 3モード化の前後で**本数も順序も変わっていない**。`tools/list` のキャッシュ前提（§18.1 #7）が壊れない。

### 19.7 モード別 rubric プリセット（実物）

`${PLUGIN_ROOT}/presets/{design,plan,implement}.json` に置き、`loop_open.rubric_preset` で選ぶ。プリセットは `PLUGIN_ROOT` 配下の**読み取り専用**であり、セッション作成時に `PLUGIN_DATA` 側へコピーされて固定される（プラグイン更新でプリセットが変わっても、進行中のセッションの rubric は動かない）。

**自動検証比率**: design 3/15 = 20%、plan 4/8 = 50%、implement 7/9 = 78%。実装に近づくほど「機械が判定できる基準」の割合が上がる、という設計方針を数で表している。

#### 19.7.1 `presets/design.json`（全文・15基準）

```json
{
  "preset": "design",
  "version": 1,
  "artifact_kind": "markdown",
  "policy": {
    "pass_score": 9, "pass_weighted_mean": 9.0,
    "max_rounds": 12, "stall_window": 3, "stall_epsilon": 0.25,
    "max_score_jump": 3, "require_command_evidence_for": ["auto"],
    "chain_max_rounds": 28
  },
  "criteria": [
    {
      "id": "failure_mode_mapping",
      "statement": "潰そうとしている失敗モードが列挙され、各失敗モードに対応する機構が1対1で存在する",
      "weight": 3,
      "verification": "manual",
      "anchors": {
        "1": "失敗モードが挙がっていない、または「気をつける」で終わっている",
        "5": "失敗モードは挙がっているが、対応する機構が一部しか無い",
        "9": "全失敗モードに対応機構があり、対応表で1対1が確認できる。機構が無い失敗モードは「守れない」と明示されている"
      }
    },
    {
      "id": "interface_completeness",
      "statement": "外部インタフェースが名前・入力スキーマ・出力スキーマ・エラー条件まで実物で書かれている",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "名前と一言説明のみ",
        "5": "入力は書かれているが出力かエラー条件が欠けている",
        "9": "全インタフェースに実物のスキーマとエラー条件があり、スキーマがバリデータを通る"
      }
    },
    {
      "id": "state_externalized",
      "statement": "ループの継続に必要な状態が、モデルの記憶ではなく外部（サーバ）に置かれている",
      "weight": 3,
      "verification": "manual",
      "anchors": {
        "1": "状態の所在が書かれていない、または会話履歴に依存している",
        "5": "状態は外部にあるが、文脈が飛んだ時の復帰手順が無い",
        "9": "全状態の所在が表になっており、1回のツール呼び出しで完全に復帰できる経路が明示されている"
      }
    },
    {
      "id": "verdict_ownership",
      "statement": "合否の判定を誰が下すかが一意に決まっており、モデルの自称が判定に混入しない",
      "weight": 3,
      "verification": "manual",
      "anchors": {
        "1": "判定の所有者が書かれていない",
        "5": "サーバが判定すると書いてあるが、モデルの所感が式に入り込む余地がある",
        "9": "判定式が入力から一意に決まり、モデルの自己申告が入る欄は記録専用であると明記されている"
      }
    },
    {
      "id": "anti_gaming",
      "statement": "スコアを不当に上げる手口が列挙され、それぞれに検出または抑止の機構がある",
      "weight": 3,
      "verification": "manual",
      "anchors": {
        "1": "ごまかしへの言及が無い",
        "5": "手口は挙がっているが、機構が「注意する」レベルに留まる",
        "9": "各手口に対して、拒否するのか記録するのかが決まっており、拒否できないものは限界として明記されている"
      }
    },
    {
      "id": "state_machine",
      "statement": "状態と遷移が全網羅され、各状態で呼べるツールと禁止されるツールが決まっている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "状態の一覧が無い",
        "5": "状態は挙がっているが、遷移表に空欄や「その他」がある",
        "9": "状態×ツールの全マスが埋まっており、到達不能な状態はその理由が示されている"
      }
    },
    {
      "id": "convergence",
      "statement": "収束条件と打ち切り条件が数値で決まっており、無限ループにならないことが示されている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "「合格するまで回す」としか書かれていない",
        "5": "上限周回はあるが、停滞の定義が無い",
        "9": "合格条件・停滞条件・上限・上限到達時の出口がすべて数値と状態で定義されている"
      }
    },
    {
      "id": "packaging_conformance",
      "statement": "配布パッケージが配布仕様に適合しており、適合が機械的に検査できる",
      "weight": 2,
      "verification": "auto",
      "anchors": {
        "1": "パッケージ構成が書かれていない",
        "5": "構成は書かれているが、マニフェストが実物ではなく説明文である",
        "9": "マニフェストが実物として載っており、スキーマ検査スクリプトが終了コード0で通る"
      }
    },
    {
      "id": "host_portability",
      "statement": "ホスト実装の差（パス・変数展開・起動方法）を吸収する方針が決まっている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "特定ホスト前提の記述しかない",
        "5": "差があることは書かれているが、吸収方法が具体的でない",
        "9": "使ってよい変数・展開が効く位置・解決できない場合の縮退が、値つきで決まっている"
      }
    },
    {
      "id": "responsibility_split",
      "statement": "サーバ・スキル・モデルの責務が重複なく分割されている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "責務の分割が書かれていない",
        "5": "分割はあるが、同じ判断を2箇所で行っている箇所がある",
        "9": "責務表があり、各判断の所有者が1箇所に決まっている。重複がある場合はどちらが優先かが明記されている"
      }
    },
    {
      "id": "auditability",
      "statement": "後から第三者が、各周で何が起きたかを成果物なしで再構成できる",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "記録の内容が書かれていない",
        "5": "記録はあるが、拒否された提出や根拠が残らない",
        "9": "受理・拒否・根拠・digest・時刻がすべて残り、出力形式がスキーマで決まっている"
      }
    },
    {
      "id": "acceptance_tests",
      "statement": "受け入れテストが、呼ぶツール列と期待される返り値まで書かれている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "テストの記述が無い",
        "5": "シナリオ名の列挙のみで、期待値が無い",
        "9": "各シナリオが具体的な呼び出し列と期待される応答（コード・状態・判定）まで書かれている"
      }
    },
    {
      "id": "defaults_decided",
      "statement": "既定値が全て決め切られており、「実装時に決める」が残っていない",
      "weight": 2,
      "verification": "auto",
      "anchors": {
        "1": "既定値がほぼ未定",
        "5": "主要な既定値はあるが、一部が「実装時に決める」",
        "9": "全既定値が値つきで表になっており、各値に理由が付いている。先送り表現（「実装時に決める」「TBD」等）の出現が、禁止語句そのものを引用・検査している箇所を除いて0件"
      }
    },
    {
      "id": "self_hosting",
      "statement": "この設計を自分自身に適用した場合の一巡が追跡されており、そこで見つけた穴が反映されている",
      "weight": 1,
      "verification": "manual",
      "anchors": {
        "1": "自己適用の記述が無い",
        "5": "適用した話は書いてあるが、穴が見つかっていない（＝追跡が浅い）",
        "9": "一巡の呼び出し列が具体的に追跡され、見つかった穴が番号つきで列挙され、各穴の反映先が示されている"
      }
    },
    {
      "id": "rejected_alternatives",
      "statement": "採らなかった選択肢が挙がり、なぜ足りないかが理由付きで書かれている",
      "weight": 1,
      "verification": "manual",
      "anchors": {
        "1": "代替案の記述が無い",
        "5": "代替案は挙がっているが「良くない」としか書いていない",
        "9": "各代替案について、どの要件を満たせないかが具体的に書かれている"
      }
    }
  ]
}
```

重みと `verification` の一覧（上の JSON の要約。重み合計 33）:

| id | 重み | verification | 一言 |
|---|---|---|---|
| `failure_mode_mapping` | 3 | manual | 失敗モードと機構の1対1 |
| `interface_completeness` | 3 | **auto** | スキーマがバリデータを通る |
| `state_externalized` | 3 | manual | 状態が外部化されている |
| `verdict_ownership` | 3 | manual | 判定の所有者が明確 |
| `anti_gaming` | 3 | manual | ごまかし対策 |
| `state_machine` | 2 | manual | 状態と遷移が全網羅 |
| `convergence` | 2 | manual | 収束と打ち切り |
| `packaging_conformance` | 2 | **auto** | 配布仕様への適合が検査で通る |
| `host_portability` | 2 | manual | ホスト差の吸収 |
| `responsibility_split` | 2 | manual | 責務分割 |
| `auditability` | 2 | manual | 監査可能性 |
| `acceptance_tests` | 2 | manual | 受け入れテスト |
| `defaults_decided` | 2 | **auto** | 未定値ゼロ |
| `self_hosting` | 1 | manual | 自己適用 |
| `rejected_alternatives` | 1 | manual | 却下した代替案 |

（`defaults_decided` を auto にできる理由: 「実装時に決める」等の禁止語句の grep 件数が0であることを、コマンド根拠で示せる。`packaging_conformance` も同様に検査スクリプトの終了コードで示せる。）

#### 19.7.2 `presets/plan.json`（全文）

```json
{
  "preset": "plan",
  "version": 1,
  "policy": {
    "pass_score": 9, "pass_weighted_mean": 9.0,
    "max_rounds": 8, "stall_window": 2, "stall_epsilon": 0.25,
    "max_score_jump": 3, "require_command_evidence_for": ["auto"],
    "chain_max_rounds": 28
  },
  "criteria": [
    {
      "id": "design_coverage",
      "statement": "上流設計書の実装を要する決定が、すべていずれかのタスクで覆われている",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "設計書の一部にしか対応していない",
        "5": "主要な節は覆っているが、覆われていない節がある",
        "9": "設計書の全節について、対応タスク id または「実装不要」の明示的な判断がある。design_refs の集合が設計書の見出し集合を覆うことをコマンドで示せる"
      }
    },
    {
      "id": "dependency_soundness",
      "statement": "タスクの依存関係が有向非巡回で、実行順が一意に決まる",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "依存が書かれていない",
        "5": "依存はあるが循環または幽霊依存がある",
        "9": "トポロジカルソートが通り、孤立タスクが無い。artifact_commit が E_PLAN_INVALID を返さない"
      }
    },
    {
      "id": "acceptance_testability",
      "statement": "各タスクの受け入れ条件が、真偽を判定できる文になっている",
      "weight": 3,
      "verification": "manual",
      "anchors": {
        "1": "「正しく動くこと」のような判定不能な文",
        "5": "半分程度が判定可能",
        "9": "全タスクの全受け入れ条件が、実行可能な検証手段または観測可能な事実に還元されている"
      }
    },
    {
      "id": "verify_commands",
      "statement": "各タスクに、成否を分ける具体的な検証コマンドと期待終了コードがある",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "検証手段が無い",
        "5": "コマンドはあるが期待終了コードや対象が曖昧",
        "9": "全タスクに command + expect_exit_code があり、コマンドが実在のツールを指している"
      }
    },
    {
      "id": "task_granularity",
      "statement": "1タスクが1〜2周のループで終わる粒度に割れている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "「実装する」1タスクだけ",
        "5": "粒度がばらばらで、巨大タスクが混ざる",
        "9": "全タスクが estimate_rounds ≤ 3 で、変更ファイル数も1タスクあたり概ね5以下"
      }
    },
    {
      "id": "no_scope_creep",
      "statement": "設計書に無い作業が計画に混入していない",
      "weight": 2,
      "verification": "auto",
      "anchors": {
        "1": "設計に無い機能が複数ある",
        "5": "1〜2件、設計との対応が説明されていないタスクがある",
        "9": "全タスクの design_refs が上流設計書に実在する。E_PLAN_DESIGN_REF が出ない"
      }
    },
    {
      "id": "risk_and_order",
      "statement": "不確実性の高いタスクが前倒しされ、後戻りコストが小さい順序になっている",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "順序に意図が無い",
        "5": "依存順ではあるがリスク順は考慮されていない",
        "9": "検証困難・前提が怪しいタスクが依存の許す範囲で最前に置かれ、その理由が summary に書かれている"
      }
    },
    {
      "id": "rollback_and_partial",
      "statement": "途中で止まった場合に、どこまでが安全に残せる状態かが定義されている",
      "weight": 1,
      "verification": "manual",
      "anchors": {
        "1": "記述が無い",
        "5": "「途中で止めない」としか書いていない",
        "9": "各タスク完了時点がビルド可能・テスト green であることが保証されるか、そうでないタスクが明示されている"
      }
    }
  ]
}
```

#### 19.7.3 `presets/implement.json`（全文）

```json
{
  "preset": "implement",
  "version": 1,
  "policy": {
    "pass_score": 9, "pass_weighted_mean": 9.0,
    "max_rounds": 16, "stall_window": 4, "stall_epsilon": 0.20,
    "max_score_jump": 3, "require_command_evidence_for": ["auto"],
    "chain_max_rounds": 28
  },
  "criteria": [
    {
      "id": "tests_green",
      "statement": "全テストが通っている（failed 0、終了コード 0）",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "テストが落ちている、または実行していない",
        "5": "一部が skip されたまま green を主張している",
        "9": "test_inventory.counts.failed = 0 かつ source_exit_code = 0 かつ skipped が前周から増えていない"
      }
    },
    {
      "id": "plan_task_completion",
      "statement": "上流計画の全タスクが done で、未着手・部分実装が残っていない",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "半分以上が未着手",
        "5": "大半は done だが、状態が申告されていないタスクがある",
        "9": "全 task id について done の申告と、それを裏づける upstream 根拠 + command 根拠がある"
      }
    },
    {
      "id": "acceptance_satisfied",
      "statement": "各タスクの受け入れ条件が、コマンド根拠で満たされていることが示されている",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "受け入れ条件に触れていない",
        "5": "口頭で「満たした」と書いてあるだけ",
        "9": "全受け入れ条件に対して、計画の verify コマンドとその終了コード・出力ハッシュ・target_digest が記録されている"
      }
    },
    {
      "id": "test_coverage_of_tasks",
      "statement": "各タスクの変更に対応するテストが存在する",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "テストが無い",
        "5": "一部のタスクにしかテストが無い",
        "9": "全タスクについて、role:\"test\" のファイルに対応するテスト id が test_inventory に存在する"
      }
    },
    {
      "id": "no_test_weakening",
      "statement": "テストを消す・skip する・アサートを弱める操作が行われていない、または申告と差分つきで正当化されている",
      "weight": 3,
      "verification": "auto",
      "anchors": {
        "1": "テストが減っているのに説明が無い",
        "5": "説明はあるが差分が添えられていない",
        "9": "テスト総数が減らず skipped も増えず、変更されたテストファイルには全て diffs が添付されている。E_TEST_REGRESSION / E_TEST_MUTATED_WITHOUT_DIFF が出ない"
      }
    },
    {
      "id": "no_unplanned_change",
      "statement": "計画の changes に無いファイルが変更されていない",
      "weight": 2,
      "verification": "auto",
      "anchors": {
        "1": "計画外の変更が多数",
        "5": "計画外の変更が数件あり、説明が無い",
        "9": "files[] のパス集合が計画の changes のパス集合に含まれる。外れるものは change_note で個別に正当化されている"
      }
    },
    {
      "id": "build_and_lint",
      "statement": "ビルドと静的検査が通っている",
      "weight": 2,
      "verification": "auto",
      "anchors": {
        "1": "ビルドが通らない",
        "5": "ビルドは通るが lint 警告を無視している",
        "9": "ビルド・lint・型検査のコマンドが終了コード 0 で、出力ハッシュと target_digest が記録されている"
      }
    },
    {
      "id": "code_quality",
      "statement": "既存コードの流儀に従い、その場しのぎの回避策が入っていない",
      "weight": 2,
      "verification": "manual",
      "anchors": {
        "1": "命名も構造も周囲と食い違う",
        "5": "動くが、例外の握り潰しや重複が残っている",
        "9": "周囲のコードと同じ語彙・同じ層構造で、TODO / FIXME / 握り潰した例外が残っていない"
      }
    },
    {
      "id": "docs_updated",
      "statement": "挙動が変わった箇所のドキュメントが更新されている",
      "weight": 1,
      "verification": "manual",
      "anchors": {
        "1": "更新なし",
        "5": "一部だけ更新",
        "9": "公開インタフェースの変更が全てドキュメントに反映され、実物と食い違わない"
      }
    }
  ]
}
```

### 19.8 実装モードのごまかし対策

「テストが通った」という自己申告をどこまで機械的に縛れるか。サーバはコマンドを実行しない（仮定 A4）ので、**真正性は証明できないが、整合性と再現手順は強制できる**。

#### 19.8.1 結合による検証

implement モードの `command` 根拠は4つ組ではなく**5つ組**を要求する。

```json
{
  "kind": "command",
  "command": "npm test -- --reporter=json",
  "exit_code": 0,
  "output_excerpt": "{\"numTotalTests\":128,\"numPassedTests\":128,\"numFailedTests\":0}",
  "output_sha256": "3f2a…",
  "target_digest": "sha256:7c1e…"
}
```

`target_digest` は**その時点のマニフェスト digest**（= `artifact_commit` が返した `artifact.digest`）でなければならない。違えば `E_EVIDENCE_TARGET`。これで塞がるのは:

| 攻撃 | なぜ塞がるか |
|---|---|
| 古い成功結果を貼り直す | 過去の `target_digest` は現在のマニフェストと一致しない |
| コードを直す前のテスト結果を使う | 同上（コミット順が digest で固定される） |
| 別ブランチ・別ディレクトリの結果を持ち込む | マニフェストが違えば digest が違う |
| 出力を要約して都合の悪い行を落とす | `output_sha256` が全出力に対するハッシュなので、`output_excerpt` と食い違えば第三者の再実行で露見する |

**`E_EVIDENCE_STALE`（既存）との関係**: 既存は「根拠が前周のダイジェストを指している」検出。`target_digest` はそれを implement モードで**必須化**したもので、新しい概念ではなく既存機構の強制である。

#### 19.8.2 テストを消す／スキップする

`test_inventory` の前周との差分をサーバが取る。

```text
prev = 直前に受理された提出の test_inventory
now  = 今回の test_inventory

removed = prev.tests の id − now.tests の id
added   = now.tests の id − prev.tests の id
skip_delta = now.counts.skipped − prev.counts.skipped

R1: removed が空でなく、removed の全 id が now.removed_tests[] に理由つきで申告されていない
    → E_TEST_REGRESSION（detail.unexplained = removed − 申告済み）
R2: skip_delta > 0 かつ 今回どれかの基準のスコアが前周より上がっている
    → E_TEST_REGRESSION（detail.raised_criteria）
R3: now.counts.total < prev.counts.total かつ removed_tests[] が空
    → E_TEST_REGRESSION
R4: now.counts.failed > 0 または source_exit_code != 0 なのに
    verification:"auto" の基準に 9 以上を付けた
    → E_TEST_NOT_GREEN（detail.criteria）
```

R1〜R3 は `artifact_commit` の受理時、R4 は `score_submit` の判定時に走る。**削除自体は禁止しない**（不要になったテストは実在する）が、**理由の申告なしには通らない**し、申告は監査 JSON に永久に残る。

#### 19.8.3 アサートを弱める

これが一番難しい。テスト id が同じままアサートだけ緩める（`toBe` → `toBeDefined`、`assert x == 3` → `assert x != None`）と、id 集合も件数も動かない。サーバはコードを読まないので意味的判定はできない。

**採った手**: テストファイルの `sha256` が変わったことは**マニフェストから機械的に分かる**。そこで、

```text
changed_test_files = { f | f.role == "test" かつ prev の同 path の sha256 != now の sha256 }

R5: changed_test_files のうち、test_inventory.diffs[] に対応する file が無いものがある
    → E_TEST_MUTATED_WITHOUT_DIFF（detail.files）
```

つまり **「テストファイルを触ったなら差分を出せ」**。差分は `command`（例 `git diff -- test/foo.test.js`）と `output_excerpt` と `output_sha256` の形で提出される。サーバは差分の中身を評価しないが、

- 差分が**監査 JSON に載る**ので、人間・レビュー用エージェント・CI のいずれもが後から読める。
- 差分を出さずにテストを緩める経路が**存在しない**（出さなければ提出が通らない）。
- 嘘の差分を出せば、`output_sha256` と実際の `git diff` 出力が食い違い、再実行で露見する。

さらに rubric 側で `no_test_weakening`（重み3、auto、アンカー9 が「変更されたテストファイルには全て diffs が添付されている」）が採点対象になっているので、**弱化は必ず可視化された上で評価される**。

#### 19.8.4 守れない範囲（正直な線引き）

| 守れること | 守れないこと |
|---|---|
| 申告どうしの内部整合（件数・id 集合・digest の連鎖） | ハッシュが**実在のファイル**のものであること |
| 第三者が同じコマンドで再現できる情報が全て残っていること | コマンドが**実際に実行された**こと |
| 過去の結果の使い回し | シェルを持つモデルが**本当に実行して本当に通してから**、テストを骨抜きにすること |
| 説明なきテスト削除・skip 増・テスト改変 | アサートが**意味的に弱い**かどうかの判定 |

**この線引きが妥当だと考える理由**: サーバにコマンド実行を持たせれば真正性は上がるが、(a) 任意コマンド実行を持つ MCP サーバは攻撃面が桁違いに広がり、(b) 実行環境（OS・シェル・ツールチェーン・作業ディレクトリ）に依存するため Agent Plugins の可搬性（`PLUGIN_ROOT` / `PLUGIN_DATA` 外に出ない、`cwd` はその2つの内側）と正面から衝突する。代償に見合わないので **A4 を維持する**。

代わりに置いた保険: 監査 JSON には**再実行に必要な情報が全部入っている**（コマンド・終了コード・出力ハッシュ・対象 digest・テスト差分）。つまり本設計が提供するのは「不正ができない」保証ではなく、**「不正が後から必ず検出可能な形で記録される」保証**である。これは §12.3 の立場（再検証可能性）をそのまま implement モードに延長したものである。

### 19.9 状態機械（3モード共通 + モード固有状態）

#### 19.9.1 判断: 状態機械は**共通**

3つ別々にすると、遷移の重複が3倍になり、`escalate` の意味がモードごとに変わる。共通の状態機械に**2状態を追加**し、追加分は「上流ピンを持つセッションだけが到達しうる」形にした。

```
                     ┌──────────────────────────────┐
                     ▼                              │
 (loop_open) ──▶ DRAFTING ──artifact_commit──▶ SCORING ──score_submit──┐
                     ▲                                                  │
                     │◀───────── 判定: 不合格 (round+1) ─────────────────┤
                     │                                                  │
                     │◀───────── 判定: 停滞 ──▶ STALLED ──escalate──────┤
                     │                                                  │
                     └────────────────────────────── 判定: 合格 ────────┴──▶ FINAL
                                                                              │
  ESCALATED ◀── escalate(request_human) ── (STALLED / 予算超過 / upstream_missing)
      │
      └── escalate(resolve) ──▶ DRAFTING | FINAL_WITH_RELAXATION | ABORTED

  ── 3モード拡張で追加 ────────────────────────────────────────────────
  FINAL ──escalate(reopen|kickback, human_token)──▶ DRAFTING   （上流側）
  任意の状態 ──上流ピンのdigest不一致を検出──▶ SUPERSEDED ──escalate(rebase)──▶ DRAFTING
  任意の状態 ──下流がkickbackを発行──▶ FROZEN ──上流が再FINAL──▶ SUPERSEDED
  FROZEN ──escalate(abort)──▶ ABORTED
```

#### 19.9.2 状態ごとに呼べるツール（改訂後・全状態）

| 状態 | `loop_open` | `loop_state` | `artifact_commit` | `score_submit` | `rubric_amend` | `escalate` | `audit_export` |
|---|---|---|---|---|---|---|---|
| `DRAFTING` | resume のみ | ○ | ○ | × `E_STATE_VIOLATION` | ○ | ○ | ○ |
| `SCORING` | resume のみ | ○ | ×（再提出は round+1 後） | ○ | × | ○ | ○ |
| `STALLED` | resume のみ | ○ | × | × | ×（`relax_rubric` 承認後のみ） | ○ | ○ |
| `ESCALATED` | resume のみ | ○ | × | × | ×（同上） | ○ | ○ |
| `FINAL` | resume のみ | ○ | × | × | × | `reopen`/`kickback` のみ | ○ |
| `FINAL_WITH_RELAXATION` | resume のみ | ○ | × | × | × | `reopen`/`kickback` のみ | ○ |
| `SUPERSEDED` | resume のみ | ○ | × `E_SUPERSEDED` | × `E_SUPERSEDED` | × | `rebase`/`abort` のみ | ○ |
| `FROZEN` | resume のみ | ○ | × `E_FROZEN` | × `E_FROZEN` | × | `abort` のみ | ○ |
| `ABORTED` | resume のみ | ○ | × | × | × | × | ○ |

#### 19.9.3 モード固有状態の到達不能性（構造的保証）

`SUPERSEDED` と `FROZEN` は **design モードでは構造的に到達不能**である。証明は3行で済む。

1. `SUPERSEDED` へ遷移する唯一の経路は §19.3.2 のピン比較で、そのコードは `session.upstream != null` の場合のみ実行される。
2. `FROZEN` へ遷移する唯一の経路は、**別セッションが** `escalate(action:"kickback")` を発行し、その `session.upstream.session_id` が自分を指す場合である。
3. `loop_open` のスキーマ（§19.6.3）の第4 `allOf` 分岐が `loop_mode:"design"` に `upstream` を禁止し（`not:{required:["upstream"]}`）、サーバも `E_UPSTREAM_NOT_ALLOWED` で二重に拒否する。また `upstream` は作成後 immutable（変更するツールが存在しない）。

したがって design セッションは `upstream == null` を生涯保ち、1 は発火しない。2 について、design セッションが `FROZEN` になるのは「design を上流とする plan セッションが kickback を発行したとき」ではなく、その場合 design は `DRAFTING` に**戻る側**（§19.4 の表）である。`FROZEN` になるのは kickback の**発行元**であり、発行元は必ず `upstream != null`。よって design は `FROZEN` にもならない。

（一方 plan セッションは `SUPERSEDED`（design が変わった）と `FROZEN`（implement から差し戻された）の**両方**を取りうる。中間モードなので当然である。）

### 19.10 収束・打ち切り・チェーン予算

#### 19.10.1 モード別の値と理由

§19.1 の表のとおり（`max_rounds`/`stall_window`/`stall_epsilon` = design 12/3/0.25、plan 8/2/0.25、implement 16/4/0.20）。値を動かした3件の理由を再掲する（§19.1「閾値をモードで変えた理由」と同一。値そのものは §7.2 の単一ループ既定から変えていないものは省く）:

| 値 | 単一ループ既定（§7.2） | モード別 | 下げた／上げた理由 |
|---|---|---|---|
| `plan.max_rounds` | 12 | **8** | 設計が確定している以上、探索空間は設計モードより狭い。8周で収束しないのは「設計が決まっていない」信号であり、周回を増やすより差し戻し（§19.4）が正しい |
| `plan.stall_window` | 3 | **2** | 計画は文章量が少なく1周あたりの情報量が大きいので、2周動かなければ本質的に詰まっている |
| `implement.max_rounds` | 12 | **16** | テスト環境・依存関係・フレーキーな失敗など**外部要因で足踏みする**周が入る。12 では正常な作業が打ち切られる |
| `implement.stall_window` | 3 | **4** | リファクタ周は一時的にスコアが伸びない |
| `implement.stall_epsilon` | 0.25 | **0.20** | 実装モードは auto 基準が 7/9 と多く、加重平均が**階段状**（テストが通るか通らないか）に動く。1周あたりの改善幅が設計・計画より小さく刻まれるため、0.25 のままだと「小さいが確実な前進」を停滞と誤検知して `STALLED` に落としてしまう。0.20 という値は重み配置から出る。implement プリセットは重み合計 22（§19.7.3）なので、**重み2と重み3の基準が各 +1 点**という「1周ぶんの最小の実質的前進」は `(2+3)/22 ≒ 0.227` にしかならず、0.25 では停滞と判定されてしまう。同じ動きは plan（重み合計 19）なら `5/19 ≒ 0.263` で 0.25 を超えるため、plan は 0.25 のままでよい。0.20 はこの 0.227 を拾い、かつ単一基準 +1（最大でも `3/22 ≒ 0.136`）は拾わない位置にある |

`pass_score` / `pass_weighted_mean` / `max_score_jump` / `require_command_evidence_for` は3モードとも §7.2 の既定のまま動かしていない（合格の厳しさをモードで変えない、§19.1 末尾）。

#### 19.10.2 チェーン予算

モード単体の上限だけでは、設計12 + 計画8 + 実装16 = **36周**まで走れてしまう。さらに差し戻しで上流が再オープンされれば上限が実質リセットされる。これを止める上位予算を置く。

| 名前 | 既定 | 定義 |
|---|---|---|
| `chain_max_rounds` | **28** | チェーンに属する全セッションの `round` の合計（再オープン後の周も加算。rebase による据え置き周は加算しない） |
| `chain_extra_rounds` | **6** | エスカレーション解決で `continue` を選んだとき、1回だけ上乗せできる量 |
| `chain_max_kickbacks` | **2** | 1チェーンで許す差し戻しの回数 |

**28 にした理由**: 単純合計 36 より小さい値にしないと上位予算の意味が無い。一方で「設計10 + 計画6 + 実装12」は現実的に起こりうる正常系なので、それ（28）は通す必要がある。28 は「全モードが各上限いっぱいまで暴走することは許さないが、1モードが上限まで使い切っても他が普通なら通る」水準である。

**判定タイミングと出口**:

```text
score_submit の判定（§7.1）の最後に:

  chain_rounds = Σ(チェーン内の全セッションの round)
  if chain_rounds > chain_max_rounds:
      verdict は通常どおり計算する（合格なら FINAL にする ← 予算超過で合格を潰さない）
      不合格なら state = ESCALATED（reason: "chain_budget_exhausted"）
      detail: { chain_rounds, limit, per_session:[{session_id, loop_mode, round}] }

  escalate(resolve, resolution:"continue") で chain_extra_rounds を1回だけ加算
  2回目の continue は E_RESOLUTION_NOT_APPLICABLE（detail.reason:"extra_rounds_already_granted"）
```

**予算超過で合格を潰さない**のは意図的である。予算は「無限に回るのを止める」ためのもので、「良い成果物を落とす」ためのものではない。潰すと、上限直前で慌てて自己採点を甘くする圧力が生まれる。

`chain_max_kickbacks` 超過時は `escalate(action:"kickback")` が `E_CHAIN_BUDGET_EXHAUSTED`（`detail.check:"kickbacks"`）を返す。3回目の差し戻しが必要なら、それは「設計が根本的に間違っている」信号なので、人間が新しいチェーンを開くべきである。

#### 19.10.3 エスカレーションの出口（3モード版）

| きっかけ | 出口 |
|---|---|
| 停滞（モード別 `stall_window`） | 既存どおり `STALLED` → `escalate` |
| `max_rounds` 超過 | 既存どおり `ESCALATED` |
| `chain_max_rounds` 超過 | `ESCALATED（chain_budget_exhausted）` → `continue`（+6, 1回限り）/ `accept_as_is` / `abort` |
| 上流が消えた | `ESCALATED（upstream_missing）` → `rebase`（本文再投入）/ `abort` |
| 差し戻し上限 | `escalate(kickback)` が `E_CHAIN_BUDGET_EXHAUSTED` |

### 19.11 永続と再開

#### 19.11.1 ディレクトリ構成（改訂後・実物）

```
$PLUGIN_DATA/rubric-loop/
├── index.json                        # label → session_id、chain_id → session_id[]
├── chains/
│   └── ch_01JQ8Z9K7M3N4P5R6S7T8V9WXY/
│       └── chain.json                # 連鎖の台帳（下記）
└── sessions/
    ├── rl_01JQ8…AAA/                 # loop_mode: design
    │   ├── session.json
    │   ├── LOCK
    │   ├── rubric/1.json
    │   ├── artifacts/<digest>.md
    │   ├── rounds/1.json … 9.json
    │   ├── escalations/
    │   └── exports/
    ├── rl_01JQ9…BBB/                 # loop_mode: plan（upstream = AAA）
    │   ├── session.json              # upstream ピンを含む
    │   ├── artifacts/<digest>.json   # 計画 JSON
    │   ├── rebases/1.json            # rebase の記録
    │   └── …
    └── rl_01JQA…CCC/                 # loop_mode: implement（upstream = BBB）
        ├── session.json
        ├── artifacts/<digest>.manifest.json   # files[] + manifest_command
        ├── test_inventory/<round>.json        # 周ごとのテスト台帳
        └── …
```

**設計上の要点**: 親子関係は**双方向に持たない**。`session.json` が親を指す（`upstream`）だけで、親は子を知らない。理由は、子が増えるたびに親を書き換えると (a) FINAL 済みセッションが変更され監査の不変性が壊れ、(b) 並行に子を作ると親の書き込みが競合するため。**チェーン全体の逆引きは `chains/<chain_id>/chain.json` が担う**（追記のみ）。

```json
{
  "chain_id": "ch_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
  "created_at": "2026-09-04T09:00:00Z",
  "policy": { "chain_max_rounds": 28, "chain_extra_rounds": 6, "chain_max_kickbacks": 2 },
  "granted_extra_rounds": 0,
  "members": [
    { "session_id": "rl_01JQ8…AAA", "loop_mode": "design",    "upstream": null,             "joined_at": "2026-09-04T09:00:00Z" },
    { "session_id": "rl_01JQ9…BBB", "loop_mode": "plan",      "upstream": "rl_01JQ8…AAA",   "joined_at": "2026-09-04T11:20:00Z" },
    { "session_id": "rl_01JQA…CCC", "loop_mode": "implement", "upstream": "rl_01JQ9…BBB",   "joined_at": "2026-09-04T13:05:00Z" }
  ],
  "kickbacks": [
    { "at": "2026-09-04T15:40:00Z", "from": "rl_01JQA…CCC", "to": "rl_01JQ9…BBB",
      "target_criteria": ["dependency_soundness"], "note": "T004 が T007 の成果物を前提にしているが依存が逆向き" }
  ],
  "events": [
    { "at": "2026-09-04T11:19:00Z", "type": "session_final", "session_id": "rl_01JQ8…AAA", "digest": "sha256:9ac1…" },
    { "at": "2026-09-04T15:40:00Z", "type": "kickback",      "session_id": "rl_01JQ9…BBB" },
    { "at": "2026-09-04T16:52:00Z", "type": "rebase",       "session_id": "rl_01JQA…CCC" }
  ]
}
```

`chain.json` は**追記のみ**（`members[]` / `kickbacks[]` / `events[]` に足すだけ）なので、書き込み競合は末尾追記の原子性（tmp + rename、§8.4）で足りる。

#### 19.11.2 ハンドル1個からの完全再開

```
loop_open{ mode:"resume", submission_id:"…", session_id:"rl_01JQA…CCC" }
  ↓ サーバが返すもの
{
  "session_id":"rl_01JQA…CCC", "chain_id":"ch_01JQ8…", "loop_mode":"implement",
  "state":"DRAFTING", "round":7, "artifact_kind":"fileset",
  "upstream":{ "session_id":"rl_01JQ9…BBB", "loop_mode":"plan",
               "artifact_digest":"sha256:4d2b…", "verdict":"FINAL", "drift":false },
  "chain":{ "chain_rounds":21, "limit":28, "members":[…] },
  "must_fix":[ { "criterion_id":"no_test_weakening", "previous_score":6, "anchors":{…} } ],
  "next_action":"artifact_commit",
  "task":"…", "rubric_version":1
}
```

続けて `loop_state{ include:["rubric","must_fix","upstream","chain","last_artifact"] }` を呼べば、**上流計画の全文・自分の前回成果物マニフェスト・rubric 全文**が返る。モデルのコンテキストが完全に空でも、ハンドル1個で作業が再開できる。**上流のハンドルを覚えている必要すら無い**（`session.json` の `upstream` から辿れる）。

#### 19.11.3 途中モードからの再開で新しいセッションを作りたい場合

上流のハンドルを失っていても、`chain_id` があれば `loop_open{ mode:"resume", label:"…" }` か `audit_export{ scope:"chain" }` から辿れる。両方失った場合は `index.json` の `label` 逆引きが最後の手段であり、それも無ければ**再開できない**（新規チェーンを開く）。この限界は明示しておく。

### 19.12 スキル分割

#### 19.12.1 判断: **1スキル**

| 案 | 評価 |
|---|---|
| 3スキル（`rubric-design` / `rubric-plan` / `rubric-implement`） | モードの選択がスキル選択に化ける。ホストのスキル選択は説明文のマッチングであり、**サーバが持っている確定情報（上流の有無・現在のモード）より弱い根拠で選ばれる**。誤選択すると `E_UPSTREAM_REQUIRED` で弾かれるだけだが、無駄な往復が増える。加えて3ファイルの共通部分（提出手順・根拠の書き方・縮退動作）が重複し、片方だけ直す事故が起きる |
| **1スキル（採用）** | モードは `loop_open` の引数であり、遷移は `next_action` としてサーバが返す。スキルは「サーバの `next_action` に従え」と書くだけでよく、モードごとの分岐はサーバ側に閉じる。§10.1 の線引き（**判断はサーバ、手順はスキル**）とも整合する |

#### 19.12.2 `skills/rubric-loop/SKILL.md`

実物は **§10.2 に置き換え済み**（同じファイルが2箇所にあると片方だけ直す事故が起きるため、本書では1箇所にしか置かない）。3モード対応で足したのは「モードの選び方」「上流が変わったと言われたら」「上流が間違っていると気づいたら」の3節と、手順3–4への implement 用の追記、縮退節のモード別記述である。

#### 19.12.3 サーバ障害時の縮退（3モード）

| モード | 縮退時に失うもの | 代替 |
|---|---|---|
| `design` | 閾値判定、インフレ検出、周回管理 | 自己採点表の添付 + `UNVERIFIED-COMPLETE` 表示 |
| `plan` | 依存グラフ検査、`design_refs` の実在検査 | 手でトポロジカルソートを示す + 見出し照合の結果を書く |
| `implement` | テスト台帳の差分検査、`target_digest` の結合、計画外変更の検出 | テスト実行結果の全文貼付 + 変更ファイル一覧 + **マージ不可の明示** |

いずれも「合格した」とは書かせない。§10.3 の方針（**サーバが無いときは合格を主張しない**）をモードごとに具体化しただけであり、方針は変えていない。

### 19.13 監査可能性（連鎖を貫く）

#### 19.13.1 `audit_export` の拡張

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["session_id"],
  "properties": {
    "session_id": { "type": "string", "pattern": "^rl_[0-9A-HJKMNP-TV-Z]{26}$" },
    "scope": {
      "enum": ["session", "chain"],
      "default": "session",
      "description": "chain を指定すると、指定セッションが属するチェーンの全メンバーを時系列で1つの JSON にまとめる"
    },
    "include_artifacts": { "type": "boolean", "default": false },
    "include_rejected": { "type": "boolean", "default": true }
  }
}
```

#### 19.13.2 チェーン監査 JSON のスキーマ（構造）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agent-plugins.org/x/rubric-loop/v1/audit-chain.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["audit_version", "chain_id", "exported_at", "policy", "sessions", "links", "integrity"],
  "properties": {
    "audit_version": { "const": 2 },
    "chain_id": { "type": "string", "pattern": "^ch_[0-9A-HJKMNP-TV-Z]{26}$" },
    "exported_at": { "type": "string", "format": "date-time" },
    "policy": { "type": "object" },
    "sessions": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "required": ["session_id", "loop_mode", "state", "rounds", "final"],
        "properties": {
          "session_id": { "type": "string" },
          "loop_mode": { "enum": ["design", "plan", "implement"] },
          "state": { "type": "string" },
          "upstream": { "type": ["object", "null"] },
          "rubric_versions": { "type": "array" },
          "rounds": { "type": "array" },
          "rejected": { "type": "array" },
          "escalations": { "type": "array" },
          "rebases": { "type": "array" },
          "final": { "type": ["object", "null"] }
        }
      }
    },
    "links": {
      "type": "array",
      "description": "上流の確定 digest と下流のピンが一致していたことの証跡",
      "items": {
        "type": "object",
        "required": ["from", "to", "upstream_digest", "verified"],
        "properties": {
          "from": { "type": "string" }, "to": { "type": "string" },
          "upstream_digest": { "type": "string" },
          "pinned_at": { "type": "string" },
          "verified": { "type": "boolean" },
          "rebased_from": { "type": ["string", "null"] }
        }
      }
    },
    "kickbacks": { "type": "array" },
    "integrity": {
      "type": "object",
      "required": ["hash_algorithm", "normalization", "chain_digest"],
      "properties": {
        "hash_algorithm": { "const": "sha256" },
        "normalization": { "type": "string" },
        "chain_digest": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" }
      }
    }
  }
}
```

`integrity.chain_digest` は、`sessions[]` を `session_id` 昇順に並べ、各セッションの `final.artifact_digest`（無ければ `"null"`）を `"<session_id> <loop_mode> <digest>\n"` の1行に正規化して連結した文字列の SHA-256。**連鎖1本を1つの値で指せる**ようにするためのもの。

#### 19.13.3 連鎖1本分の実例（design → plan → implement）

紙面のため各セッションの周回は抜粋（`rounds[]` は最終周と、判定が動いた周のみ）だが、**構造は完全**である。

```json
{
  "audit_version": 2,
  "chain_id": "ch_01JQ8Z9K7M3N4P5R6S7T8V9WXY",
  "exported_at": "2026-09-04T18:20:00Z",
  "policy": {
    "chain_max_rounds": 28, "chain_extra_rounds": 6, "chain_max_kickbacks": 2,
    "granted_extra_rounds": 0, "chain_rounds_used": 22
  },
  "sessions": [
    {
      "session_id": "rl_01JQ8ZAAAAAAAAAAAAAAAAAAAA",
      "loop_mode": "design",
      "label": "rubric-loop-modes-design",
      "state": "FINAL",
      "upstream": null,
      "artifact_kind": "markdown",
      "task": "rubric ループを design/plan/implement の3モードに拡張する設計書を書く",
      "rubric_versions": [
        { "version": 1, "source": "preset:design", "criteria_count": 15, "created_at": "2026-09-04T09:00:02Z" }
      ],
      "rounds": [
        {
          "round": 1, "submission_id": "s-des-r1-8f2a",
          "artifact_digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          "change_note": "初版。3モードの定義と連鎖機構を書いた",
          "addresses": [],
          "diff": { "added_lines": 620, "removed_lines": 0, "changed_ratio": 1.0 },
          "scores": [
            { "criterion_id": "failure_mode_mapping", "score": 6, "weakness": "F15-F20 の対策側が薄い",
              "evidence": [ { "kind": "locator", "locator": "§2 表", "excerpt": "F15 | 上流変更の無視" } ] },
            { "criterion_id": "interface_completeness", "score": 5, "weakness": "escalate の新 action にスキーマが無い",
              "evidence": [ { "kind": "locator", "locator": "§19.6.5", "excerpt": "action の enum" } ] }
          ],
          "verdict": "REVISE",
          "weighted_mean": 6.4,
          "must_fix": ["interface_completeness", "failure_mode_mapping"]
        },
        {
          "round": 5, "submission_id": "s-des-r5-c31d",
          "artifact_digest": "sha256:9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4",
          "change_note": "全新規スキーマを実物化し、禁止語句を0にした",
          "addresses": ["interface_completeness", "defaults_decided"],
          "diff": { "added_lines": 210, "removed_lines": 46, "changed_ratio": 0.19 },
          "scores": [
            { "criterion_id": "interface_completeness", "score": 9,
              "weakness": "audit-chain スキーマの $id が実在 URL ではない（意図的）",
              "rationale": "loop_open / artifact_commit / escalate / audit_export の全入力スキーマを Draft 2020-12 で書き切り、7件の具体インスタンスで if/then/oneOf の挙動を確認した",
              "evidence": [
                { "kind": "command", "command": "node tools/validate-schemas.js docs/design-rubric-loop-mcp.md",
                  "exit_code": 0, "output_excerpt": "22 json blocks parsed, 18 schemas valid, 7/7 instances OK",
                  "output_sha256": "5a7d3e91c04b28f6a1d5e70b93c2846fd1e0a5b7c93d264f8e01b7a5d3c96e42" }
              ] },
            { "criterion_id": "defaults_decided", "score": 9,
              "weakness": "chain_max_rounds=28 の根拠は実測ではなく推定",
              "rationale": "既定値表に全項目を値と理由つきで載せ、禁止語句の出現が0であることを grep で確認した",
              "evidence": [
                { "kind": "command", "command": "grep -n '実装時に決める\\|TBD\\|後で決める' docs/design-rubric-loop-mcp.md | grep -v '禁止語句\\|grep -\\|anchors'",
                  "exit_code": 1, "output_excerpt": "(no output)",
                  "output_sha256": "b7e1c04a92f5d386a0e1b4c72d95f803a1c6e5d47b92f08a3d61c5e70b942f13" }
              ] }
          ],
          "verdict": "PASS",
          "weighted_mean": 9.2,
          "must_fix": []
        }
      ],
      "rejected": [
        { "round": 3, "submission_id": "s-des-r3-1a0f", "reason": "E_ADDRESS_MISSING",
          "detail": { "required": "interface_completeness" }, "at": "2026-09-04T10:11:00Z" }
      ],
      "escalations": [],
      "rebases": [],
      "final": {
        "at": "2026-09-04T11:19:00Z",
        "round": 5,
        "artifact_digest": "sha256:9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4",
        "weighted_mean": 9.2,
        "relaxed": false
      }
    },

    {
      "session_id": "rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB",
      "loop_mode": "plan",
      "label": "rubric-loop-modes-plan",
      "state": "FINAL",
      "upstream": {
        "session_id": "rl_01JQ8ZAAAAAAAAAAAAAAAAAAAA",
        "loop_mode": "design",
        "artifact_digest": "sha256:9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4",
        "verdict": "FINAL",
        "pinned_at": "2026-09-04T11:20:00Z"
      },
      "artifact_kind": "plan",
      "rubric_versions": [
        { "version": 1, "source": "preset:plan", "criteria_count": 8, "created_at": "2026-09-04T11:20:01Z" }
      ],
      "rounds": [
        {
          "round": 4, "submission_id": "s-pln-r4-77b2",
          "artifact_digest": "sha256:4d2b8e11c7a03f95d6e284b70c1f5a39e8d04b6172c95f8a30d1e6b47c05a982",
          "change_note": "T004 と T007 の依存を逆転させ、全タスクに verify を付けた",
          "addresses": ["dependency_soundness", "verify_commands"],
          "diff": { "added_lines": 88, "removed_lines": 31, "changed_ratio": 0.22 },
          "scores": [
            { "criterion_id": "design_coverage", "score": 9,
              "weakness": "§14 セルフホスティングは実装不要と判断したが、判断の記録が summary の1行のみ",
              "rationale": "設計書の全見出し 21 件に対して、対応タスク id または実装不要の判断を対応表にした。集合差が空であることをコマンドで確認した",
              "evidence": [
                { "kind": "upstream", "upstream_locator": "§19.5.3 artifact_kind: \"fileset\"",
                  "excerpt": "各 files[i] を \"<sha256>  <path>\\n\" の1行に正規化し" },
                { "kind": "command", "command": "node tools/plan-coverage.js plan.json design.md",
                  "exit_code": 0, "output_excerpt": "headings=21 covered=21 uncovered=0",
                  "output_sha256": "c1d4a70e93b2568f0a1e4c7b93d2860a5f1c7e40b8d92a36e05c1b47f9a3d268" }
              ] },
            { "criterion_id": "dependency_soundness", "score": 9,
              "weakness": "並列実行可能なタスクを明示していない",
              "rationale": "12 タスクの依存グラフがトポロジカルソート可能で、幽霊依存も孤立タスクも無いことをサーバの受理で確認した",
              "evidence": [
                { "kind": "command", "command": "node tools/toposort.js plan.json",
                  "exit_code": 0, "output_excerpt": "order: T001 T002 T003 T005 T004 T006 …",
                  "output_sha256": "e0b91c7d345a86f2019c4b7de8305a16b9c2d740e18f36a5c904b1e7d2a385f6" }
              ] }
          ],
          "verdict": "PASS",
          "weighted_mean": 9.1,
          "must_fix": []
        }
      ],
      "rejected": [
        { "round": 2, "submission_id": "s-pln-r2-4e9c", "reason": "E_PLAN_INVALID",
          "detail": { "check": "cycle", "task_id": "T004" }, "at": "2026-09-04T12:02:00Z" },
        { "round": 3, "submission_id": "s-pln-r3-9d13", "reason": "E_PLAN_DESIGN_REF",
          "detail": { "task_id": "T011", "ref": "§21 プラグイン自動更新" }, "at": "2026-09-04T12:40:00Z" }
      ],
      "escalations": [
        { "escalation_id": "e-pln-1", "action": "kickback_received",
          "from_session": "rl_01JQAZCCCCCCCCCCCCCCCCCCCC",
          "target_criteria": ["dependency_soundness"],
          "note": "T004 が T007 の成果物を前提にしているが依存が逆向きで、実装順に並べると T004 が失敗する",
          "at": "2026-09-04T15:40:00Z", "channel": "token_file", "resolved_at": "2026-09-04T16:10:00Z" }
      ],
      "rebases": [],
      "final": {
        "at": "2026-09-04T16:10:00Z",
        "round": 6,
        "artifact_digest": "sha256:7e5c02a9d4b1836f0c2e97a5b3d18604f7a2c95e1b08d3746a9c5e207b1f4d38",
        "weighted_mean": 9.3,
        "relaxed": false,
        "note": "kickback により round 5-6 で再確定。digest が round 4 と異なる"
      }
    },

    {
      "session_id": "rl_01JQAZCCCCCCCCCCCCCCCCCCCC",
      "loop_mode": "implement",
      "label": "rubric-loop-modes-impl",
      "state": "FINAL",
      "upstream": {
        "session_id": "rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB",
        "loop_mode": "plan",
        "artifact_digest": "sha256:7e5c02a9d4b1836f0c2e97a5b3d18604f7a2c95e1b08d3746a9c5e207b1f4d38",
        "verdict": "FINAL",
        "pinned_at": "2026-09-04T16:52:00Z",
        "previous_pin": "sha256:4d2b8e11c7a03f95d6e284b70c1f5a39e8d04b6172c95f8a30d1e6b47c05a982"
      },
      "artifact_kind": "fileset",
      "rubric_versions": [
        { "version": 1, "source": "preset:implement", "criteria_count": 9, "created_at": "2026-09-04T13:05:01Z" }
      ],
      "rounds": [
        {
          "round": 11, "submission_id": "s-imp-r11-b04e",
          "artifact_digest": "sha256:a3f70b2c815d94e6027fa1c58b360d947e2a1c6b0d385f47e91a2c60b84d7f13",
          "change_note": "rebase 後、T004/T007 の順序変更を反映し、依存注入のテストを2本足した",
          "addresses": ["plan_task_completion", "test_coverage_of_tasks"],
          "manifest": {
            "file_count": 34, "test_file_count": 11, "total_bytes": 412903,
            "manifest_command": "git ls-files -z | xargs -0 sha256sum | sort -k2",
            "manifest_output_sha256": "d5b8e01a37c9425f6e0b1c94d783a205e6c1b7f09a3d248e5f70b91c3d6a84e2"
          },
          "test_inventory": {
            "source_command": "npm test -- --reporter=json",
            "source_exit_code": 0,
            "source_output_sha256": "8c0d1e5a92b74f36085a1d7c4e93b620f5a8d3c17e04b962a1d85c30f7e2b419",
            "counts": { "total": 128, "passed": 128, "failed": 0, "skipped": 0 },
            "prev_counts": { "total": 126, "passed": 126, "failed": 0, "skipped": 0 },
            "removed_tests": [],
            "changed_test_files": ["test/upstream_pin.test.js"],
            "diffs": [
              { "file": "test/upstream_pin.test.js",
                "command": "git diff HEAD~1 -- test/upstream_pin.test.js",
                "output_excerpt": "-  assert.ok(res.upstream);\n+  assert.equal(res.upstream.artifact_digest, PINNED);",
                "output_sha256": "1f9a3c05e7b24d86903c1a5e7b04d926f8c3a10e5d74b962c05e83a1d7f4b620" }
            ]
          },
          "diff": { "added_files": 2, "removed_files": 0, "modified_files": 5, "changed_ratio": 0.21 },
          "scores": [
            { "criterion_id": "tests_green", "score": 9,
              "weakness": "フレーキーなタイマーテストが1本あり、3回連続実行で確認したが根本解決ではない",
              "rationale": "128 件全通過、終了コード 0、skipped 0。前周 126 件から 2 件増でテスト削除は無い",
              "evidence": [
                { "kind": "command", "command": "npm test -- --reporter=json", "exit_code": 0,
                  "output_excerpt": "{\"numTotalTests\":128,\"numPassedTests\":128,\"numFailedTests\":0,\"numPendingTests\":0}",
                  "output_sha256": "8c0d1e5a92b74f36085a1d7c4e93b620f5a8d3c17e04b962a1d85c30f7e2b419",
                  "target_digest": "sha256:a3f70b2c815d94e6027fa1c58b360d947e2a1c6b0d385f47e91a2c60b84d7f13" }
              ] },
            { "criterion_id": "no_test_weakening", "score": 9,
              "weakness": "diff の粒度がファイル単位で、1ファイル内の複数変更が1つにまとまっている",
              "rationale": "テスト総数は 126→128 で増加、skipped は 0 のまま、変更したテストファイル 1 件には差分を添付した。差分の内容はアサートの強化（ok → equal）である",
              "evidence": [
                { "kind": "command", "command": "git diff HEAD~1 -- test/upstream_pin.test.js", "exit_code": 0,
                  "output_excerpt": "-  assert.ok(res.upstream);\n+  assert.equal(res.upstream.artifact_digest, PINNED);",
                  "output_sha256": "1f9a3c05e7b24d86903c1a5e7b04d926f8c3a10e5d74b962c05e83a1d7f4b620",
                  "target_digest": "sha256:a3f70b2c815d94e6027fa1c58b360d947e2a1c6b0d385f47e91a2c60b84d7f13" }
              ] },
            { "criterion_id": "plan_task_completion", "score": 9,
              "weakness": "T012（ドキュメント更新）は実装ではないため、コマンド根拠が grep のみ",
              "rationale": "計画の全 12 タスクについて done を申告し、各タスクの verify コマンドの終了コードを記録した",
              "evidence": [
                { "kind": "upstream", "upstream_locator": "tasks[3].verify[0].command",
                  "excerpt": "node --test test/upstream_pin.test.js" },
                { "kind": "command", "command": "node --test test/upstream_pin.test.js", "exit_code": 0,
                  "output_excerpt": "# pass 9\n# fail 0",
                  "output_sha256": "20a5c1e83b74d096f1a5e2c7b840d13956e0a7c4b92d386f1c05a7e3b1d64f80",
                  "target_digest": "sha256:a3f70b2c815d94e6027fa1c58b360d947e2a1c6b0d385f47e91a2c60b84d7f13" }
              ] }
          ],
          "verdict": "PASS",
          "weighted_mean": 9.1,
          "must_fix": []
        }
      ],
      "rejected": [
        { "round": 7, "submission_id": "s-imp-r7-2c88", "reason": "E_TEST_REGRESSION",
          "detail": { "check": "R3", "prev": 126, "now": 121, "unexplained": ["pin drift detected","kickback freezes downstream","…"] },
          "at": "2026-09-04T15:20:00Z" },
        { "round": 9, "submission_id": "s-imp-r9-5ab1", "reason": "E_EVIDENCE_TARGET",
          "detail": { "expected": "sha256:a3f70b2c…", "actual": "sha256:6b1c40e9…" },
          "at": "2026-09-04T17:05:00Z" }
      ],
      "escalations": [
        { "escalation_id": "e-imp-1", "action": "kickback", "to_session": "rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB",
          "target_criteria": ["dependency_soundness"],
          "note": "T004 が T007 の成果物を前提にしているが依存が逆向きで、実装順に並べると T004 が失敗する",
          "human_token_fingerprint": "sha256:0a91…", "channel": "token_file",
          "at": "2026-09-04T15:40:00Z" }
      ],
      "rebases": [
        { "at": "2026-09-04T16:52:00Z",
          "from_digest": "sha256:4d2b8e11c7a03f95d6e284b70c1f5a39e8d04b6172c95f8a30d1e6b47c05a982",
          "to_digest": "sha256:7e5c02a9d4b1836f0c2e97a5b3d18604f7a2c95e1b08d3746a9c5e207b1f4d38",
          "invalidated": ["plan_task_completion", "acceptance_satisfied"],
          "carried_over": ["tests_green", "test_coverage_of_tasks", "no_test_weakening",
                           "no_unplanned_change", "build_and_lint", "code_quality", "docs_updated"],
          "reason": "upstream_drift after kickback resolution" }
      ],
      "final": {
        "at": "2026-09-04T18:15:00Z",
        "round": 11,
        "artifact_digest": "sha256:a3f70b2c815d94e6027fa1c58b360d947e2a1c6b0d385f47e91a2c60b84d7f13",
        "weighted_mean": 9.1,
        "relaxed": false
      }
    }
  ],

  "links": [
    { "from": "rl_01JQ8ZAAAAAAAAAAAAAAAAAAAA", "to": "rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB",
      "upstream_digest": "sha256:9ac1f0d3e8b74c2159ad06e7c4b8213fd95e0a7716cc4d3b8e2f501a9d76b3c4",
      "pinned_at": "2026-09-04T11:20:00Z", "verified": true, "rebased_from": null },
    { "from": "rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB", "to": "rl_01JQAZCCCCCCCCCCCCCCCCCCCC",
      "upstream_digest": "sha256:7e5c02a9d4b1836f0c2e97a5b3d18604f7a2c95e1b08d3746a9c5e207b1f4d38",
      "pinned_at": "2026-09-04T16:52:00Z", "verified": true,
      "rebased_from": "sha256:4d2b8e11c7a03f95d6e284b70c1f5a39e8d04b6172c95f8a30d1e6b47c05a982" }
  ],

  "kickbacks": [
    { "at": "2026-09-04T15:40:00Z",
      "from": "rl_01JQAZCCCCCCCCCCCCCCCCCCCC", "to": "rl_01JQ9ZBBBBBBBBBBBBBBBBBBBB",
      "target_criteria": ["dependency_soundness"],
      "downstream_state_after": "FROZEN",
      "upstream_state_after": "DRAFTING",
      "resolved_at": "2026-09-04T16:10:00Z" }
  ],

  "integrity": {
    "hash_algorithm": "sha256",
    "normalization": "UTF-8 NFC / CRLF→LF / 行末空白除去 / 末尾改行1つ",
    "chain_digest": "sha256:f04a1c9e73b2568d0a1f4c93b7e026d5a8c31f70b9e4d268a05c1b37e9f462d0"
  }
}
```

#### 19.13.4 第三者が再検証できること

この JSON 1つから、外部の検証者は次を**サーバに聞かずに**確認できる。

| 主張 | 確認方法 |
|---|---|
| 設計が確定した | `sessions[0].final.artifact_digest` と `rounds[].verdict:"PASS"`。成果物本文（`include_artifacts:true`）を正規化して SHA-256 を取り直せば digest が一致する |
| **その設計から**計画が出た | `links[0].upstream_digest` が `sessions[0].final.artifact_digest` と一致。さらに plan の `scores[].evidence[kind:"upstream"].excerpt` が設計書本文に実在する |
| **その計画から**実装が出た | `links[1].upstream_digest` が `sessions[1].final.artifact_digest` と一致。implement の `upstream` 根拠が計画 JSON の該当パスに実在する |
| 途中で計画が差し戻された事実 | `kickbacks[0]` と、implement 側の `rebases[0]`（`from_digest` が古いピン、`to_digest` が新しい確定 digest） |
| 差し戻し後に何を再検証したか | `rebases[0].invalidated` が2件、`carried_over` が7件。invalidated の2件は round 11 で採点し直されている |
| テストがごまかされていない | `rejected[]` に `E_TEST_REGRESSION`（121件に減らした提出が弾かれた記録）が残る。最終周の `test_inventory` は 128/0/0 で、変更テストファイルには差分が添付されている |
| 判定が甘くなかった | 各 `scores[].evidence[]` のコマンドを**手元で再実行**し、`output_sha256` と `target_digest` を突き合わせる |

最後の行が肝である。サーバはコマンドを実行しないので真正性を保証しないが、**再実行に必要な情報が全て揃っている**ため、疑わしければ検証者が自分で確かめられる。

---

## 20. 改訂履歴

### 20.1 この改訂で足したもの（新規）

| 箇所 | 内容 |
|---|---|
| §0 | 用語5件（モード / チェーン / 上流ピン / 失効 / 差し戻し） |
| §1.2 | 仮定 A9（モデルがハッシュを計算できる）・A10（1チェーンは1人の管理下） |
| §2 | 失敗モード F15–F20（上流無視・失効放置・辻褄合わせ・スコープ膨張・テスト骨抜き・連鎖暴走） |
| §4.2 | 状態 `SUPERSEDED` / `FROZEN` の行 |
| §8.1 | `chains/<chain_id>/chain.json`、`rebases/`、`test_inventory/` |
| §9.1 | `presets/`（コンポーネントではない付属データ） |
| §13 | 受け入れテスト AT-10〜AT-18（9本） |
| §14.3 | 3モードでのセルフホスティングと、そこで見つけた穴 H8–H12 |
| §15 | 却下した代替案 H〜N（7件） |
| §16 | モード別既定値・チェーン予算・`fileset`/`plan` の上限など15行 |
| §19 | 3モード拡張の全体（13小節） |
| §19.6.7 | 全7ツール総覧（名前・目的・入力／出力スキーマの所在・返しうるエラーの全数） |
| §14.3.4 | auto 基準の根拠として実際に走らせる検査コマンドと、この改訂での結果 |
| §20 | 本節 |

### 20.2 この改訂で**変えた**もの（既存の決定の変更）

黙って変えた箇所は無い。変更は以下の5件のみで、それぞれ理由と移行手順を書く。

| # | 何を | 変更前 → 変更後 | なぜ | 移行手順 |
|---|---|---|---|---|
| C1 | `loop_open` の `submission_id` | 任意（存在しなかった） → **必須** | セルフホスティングで実際に踏んだ穴 H8。ULID は毎回違うので、通信断で再送するとセッションが2つできる。MCP 2026-07-28 は再送を前提にしている（§18.1 #6）以上、状態を変える全ツールに冪等キーが要る | 既存の呼び出し側は `submission_id` を足すだけ。サーバは未指定を `E_VALIDATION` で拒否する。**既存セッションのデータ形式は変わらない** |
| C2 | `rubric_amend` / `escalate` の `submission_id` | 存在しなかった → **必須** | C1 と同じ理由。`escalate` は人間承認を伴うので二重適用の害が大きい | 同上 |
| C3 | `artifact_commit` の `content` | 単独で必須 → `content` と `files` の `oneOf`（どちらか一方） | implement モードの成果物が複数ファイルの集合であり、単一文字列では 1MB 上限・ファイル単位の差分・テスト資産の増減のいずれも扱えない（§19.5.1 の判断） | `artifact_kind` が `markdown`/`text`/`plan` のセッションでは従来どおり `content` のみが受理される。**既存セッションの挙動は変わらない**（`fileset` は新設の kind） |
| C4 | §10.2 の `SKILL.md` | 単一モード版 → 3モード対応版に**差し替え** | 同じファイルの実物が2箇所にあると片方だけ直す事故が起きる。§19.12.2 は §10.2 を指すだけにした | スキルファイルを置き換える。既存の手順1–6 の骨格と「FINAL を名乗らない」原則は不変で、モード選択・rebase・kickback・縮退のモード別記述が加わっただけ |
| C6 | ツールスキーマの**置き場所** | §6.4（拡張前の版）と §19.6.3–19.6.5（改訂版）の二重掲載 → **§6.4 に一本化** | 同じスキーマが2箇所にあると片方だけ直す事故が起きる（§20.2 C4 と同じ理由）。周回1の版では `loop_open` の `required` が §6.4.1 で `["mode"]`、§19.6.3 で `["mode","submission_id"]` と食い違っており、実装者がどちらを読むかで結果が変わる状態だった | §6.4 の7ツールをすべて3モード対応後の確定版に置き換え、§19.6.3–19.6.5 は差分表にした。**スキーマの内容は周回1の §19.6.x と同一**で、移した以外の変更は無い。あわせて §6.4.2 の `include`・出力、§6.4.4 の根拠、§6.4.5 の `submission_id`、§6.4.7 の `scope` も反映した |
| C5 | §6.2 エンベロープの `session_id` 例 | `sess_20260904_rubric-loop-design` → `rl_01JQ8Z9K7M3N4P5R6S7T8V9WXY` | §6.4.1 と §16 は既に「サーバ発行の ULID、`rl_` 前置」と決めていたのに、§6.2 / §8.3 / §12.2 / §14 の例が旧形式のまま残っていた（前回改訂 H6 の反映漏れ）。**設計の変更ではなく既存決定への追従** | 例示の修正のみ。あわせて §14 のトレース冒頭が `loop_open` に `session_id` を渡していた誤りも直した（`mode:"create"` では `E_HANDLE_NOT_ACCEPTED` になるため） |

### 20.3 この改訂で**変えなかった**もの（意図的に維持）

| 決定 | なぜ維持したか |
|---|---|
| **ツールは7本のまま** | 連鎖・失効・差し戻し・ファイル集合はすべて引数追加で表現できた。新規ツール候補6件は §19.6.1 で1つずつ却下した |
| `tools/list` の固定順 | §18.1 #7 の決定。順序が変わるとキャッシュの前提が崩れる |
| **仮定 A4（サーバはコマンドを実行しない）** | 実装モードでは真正性を上げたい誘惑が最も強いが、任意コマンド実行は攻撃面と可搬性の代償が見合わない（§19.8.4 / 却下案 L）。代わりに「不正が記録される」保証に徹した |
| 仮定 A3（ワークスペースを読まない） | 同上。`fileset` のハッシュはモデルの申告である（A9 として明示） |
| `pass_score` / `pass_weighted_mean` = 9 / 9.0 | **モードによって合格の厳しさを変えない**。緩めたいなら rubric の基準を議論すべきで、閾値操作は §5.3 の `policy_change`（人間承認必須）である |
| `loop_open.mode` の名前と値（`create`/`resume`/`create_or_resume`） | ループのモードとは別概念。同じ名前を使い回すと意味が壊れるので、新概念を `loop_mode` という別フィールドにした（§19.6.2） |
| 状態機械を3モードで**共通**にする | 別々にすると遷移が3倍になり `escalate` の意味がモードごとに変わる。追加は2状態のみで、design では構造的に到達不能であることを証明した（§19.9.3） |
| §5 の rubric スキーマ | プリセットは同じスキーマの**インスタンス**であり、スキーマ自体は1文字も変えていない |
| §9.2 `plugin.json` / §9.3 `mcp.json` | コンポーネントの種類（`skills/` と `mcp.json`）も、`command` の単一実行トークン性も、使用する変数（`PLUGIN_ROOT` / `PLUGIN_DATA`）も変わらない。`presets/` は `server/` と同じく「コンポーネントではない付属物」 |
| §12 のセッション単位監査 JSON | チェーン監査は `audit_version:2` の**別スキーマ**として足した。既存のエクスポートは読めなくならない |
| §18 の MCP 適合方針 | プロトコルセッション非依存・サーバ発行ハンドル・冪等キーという方向は、連鎖でも同じ。`chain_id` も**サーバが発行する**ハンドルであり、クライアントは自称できない |
| `E_*` を `structuredContent.error.code` で返す | 新設19件も同じ（§19.6.6） |
| §6.4 の**構成**（7ツール × 目的／入力／出力／エラー条件） | 節の構成も並び順も変えていない。中身を3モード対応後の版に差し替えただけで、読む場所は増えていない（§20.2 C6） |
| §5 の判定式・§7.1 の手順・§11 の正規化 | 3モードで**共通**。モードごとに判定式が変わると、合格の意味がモードによって違うことになる |

### 20.4 既存の表への反映漏れが無いことの確認

| 表 | 反映内容 |
|---|---|
| §2 失敗モード表 | F15–F20 を追加。合計20件（目次も 13件 → 20件 に修正） |
| §4.2 状態表 | `SUPERSEDED` / `FROZEN` の2行を追加。根拠リストに項5を追加 |
| §6.1 ツール表 | 「7本のまま」「差分は §19.6.2」「**スキーマの実物は §6.4 に1箇所**」「総覧は §19.6.7」を注記 |
| §6.4 全7ツール | 入力スキーマを3モード対応後の確定版に差し替え（`loop_open`/`artifact_commit`/`escalate`）、`loop_state` の `include`・出力、`score_submit` の根拠3分岐、`rubric_amend` の `submission_id`、`audit_export` の `scope` を追加。エラー表に追加19件を各ツールへ配分 |
| §6.2 エンベロープ | `loop_mode` / `chain_id` / `upstream` の追加を明記。例の `session_id` を ULID に修正 |
| §6.3 エラー表 | 追加19件の所在（§19.6.6）を明記 |
| §7.2 既定値表 | design の値であることと、モード別上書きの所在を明記 |
| §8.1 レイアウト | `chains/` / `rebases/` / `test_inventory/` を追加 |
| §9.1 パッケージ | `presets/` を追加し、コンポーネント種別は不変と明記 |
| §10.2 SKILL.md | 3モード対応版に差し替え（C4） |
| §13 見出し | AT-1〜9 と AT-10〜18 の役割分担を明記。目次も 9本 → 18本 に修正 |
| §16 既定値まとめ | モード別・チェーン別の15行を追加 |
| §19.7.1 design プリセット | 抜粋4件 → **15基準の全文 JSON**（重み合計33・auto 3件）に差し替え。plan/implement は元から全文 |
| §17 注記 | 3モードで決め切った項目と、正直に書いた限界を追加 |
| §18.1 表 | #6（冪等キーの適用範囲拡大）と #7（ツール本数不変）を更新 |
| 目次 | §19 / §20 を追加、F件数と AT 本数を修正 |

### 20.5 rev.4 — 下流（実装計画）からの差し戻し（KICKBACK）7件の反映

計画側で見つかった本書の不整合 KB-1〜KB-7 を修正した。**仕様・既定値・ツール本数・状態機械は一切変えていない**（記述の不整合と未規定の解消のみ）。

| # | 箇所 | 何が壊れていたか | どう直したか |
|---|---|---|---|
| KB-1 | §2 失敗モード表 | 行順が F12, F14, F13, F15 と昇順でなく、番号参照（§19.8.2 など）と読み合わせると行を取り違える | F13 と F14 の**行順のみ**を入れ替えた。番号の振り直しはしていないので既存の参照は全て有効 |
| KB-2 | §9.1 / §9.4 | 同名 `mcp.json` の実物が2つあり、固定位置に1つしか置けないのにどちらをどう同梱するかが未規定 | streamable-http 版のファイル名を **`mcp.http.json`** と定め、§9.1 の構成図に追加。既定は `mcp.json`（stdio）で、切り替えは利用者のリネームであることを §9.4 に明記。`mcp.http.json` はコンポーネントとして発見されないため既定動作は不変 |
| KB-3 | §8.4 | LOCK に入れる `boot_id` の取得方法が未規定（`/proc/sys/kernel/random/boot_id` は Linux 限定） | OS 起動識別子 → 起動時刻の UUIDv5 → `PLUGIN_DATA/instance_id` の3経路を表で定義し、採った経路を `boot_id_source` に記録。代用時は陳腐化判定が**60秒経過のみに縮退**することと、`loop_state` の `warnings` に `"lock_staleness_time_only"` を出すことを明記。§8.1 のレイアウトに `instance_id` を追加 |
| KB-4 | §19.5.2 | task スキーマの `required` に `design_refs` が無いのに、機械検査は全 `design_refs` の上流実在を要求していた（欠落タスクが合法か不明） | `design_refs` を **`required` に追加**（F18「全タスクに必須化」と整合）。欠落・空配列は `E_PLAN_SCHEMA`、実在しない参照は `E_PLAN_DESIGN_REF` と役割分担を明記 |
| KB-5 | §19.6.7 / §6.3 / §6.4.4 | 総覧の各行が「共通6件込みの全数」なのか「固有の追加分」なのか未定義で、`score_submit` の行だけ `E_VALIDATION` が抜けていた | 冒頭に**「共通エラー条件を含む全数（`E_INTERNAL` のみ除外）」**と定義。`score_submit`（18→19件）と `loop_state`（1→2件）に `E_VALIDATION` を追加し、§6.4.2 / §6.4.4 のエラー表も揃えた。のべ 59→61、重複除去 41 と `E_INTERNAL` で定義済み42件は不変 |
| KB-6 | §13 | AT-1〜9 が「AT-1 正常収束（1本）」、AT-10〜18 が「AT-10: …」と2記法混在で、見出しの機械照合に規則が2つ要る | 全18件を **`### AT-<番号>: <目的>`** に統一（`（1本）` は「1 AT = 1本」を §13 冒頭に書いて削除）。AT 番号は変えていないので既存の参照は全て有効 |
| KB-7 | §19.10.1 / §7.2 / §16 | `implement.stall_epsilon = 0.20` の根拠が §19.1 にしかなく、値をまとめている節から辿れない | §19.10.1 にモード別の値と理由の表を置き、0.20 を**重み配置から導出**して示した（implement は重み合計22なので「重み2と3の基準が各 +1」= `5/22 ≒ 0.227` が 0.25 では停滞と誤判定される。plan は重み合計19で `5/19 ≒ 0.263` のため 0.25 のままでよい）。§7.2 と §16 から §19.10.1 への参照を追加。**値は変えていない** |
