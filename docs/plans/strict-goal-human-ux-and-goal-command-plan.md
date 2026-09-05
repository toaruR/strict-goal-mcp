# strict-goal 人語指示対応 & `/goal` コマンド統合 計画

## 概要 (Problem & Background)

`strict-goal` は、LLMの自己採点の甘え・ごまかし・早期完了宣言をサーバー側で厳格に排除する優れた決定論的ハーネスです。
しかし現状、以下の課題があります:
1. **指示の出しにくさ（機械的ツールの露出）**: ユーザーが「〇〇を実装して」と自然言語で依頼しても、エージェントは 7 つの低レベル MCP ツール（セッションID、sha256ダイジェスト、JSON-DAG、fileset、テストインベントリ等）の手動操作に戸惑い、人語から自律的にループを開始・完遂する手引きが不足している。
2. **`/goal` との乖離**: Antigravity / Claude Code / Codex における `/goal <指示>` は「目標完遂まで粘り強く自律実行する」定番のインターフェース。現状 `strict-goal` はこの直感的な UX に接続されておらず、プロジェクトの `.claude/skills/` や `.agents/skills/` にも登録されていない。
3. **`implement` モードの入力作成コスト**: ファイル一覧の sha256、テストインベントリ、diff などの手動構築が重く、エージェントのコンテキスト浪費や入力ミスの原因となっている。

本改修では、**人語指示（「strict-goalで〇〇して」）および `/goal`・`/strict-goal` コマンドから、AIエージェントが完全自律で `design` → `plan` → `implement` の検証ループを回し切るための統合体験** を構築します。

---

## 提案する変更内容 (Proposed Changes)

### 1. スキル整備・コマンド連携 (`.agents/skills/`, `.claude/skills/`, `strict-goal/skills/`)

#### [NEW] `.agents/skills/strict-goal/SKILL.md` & `.claude/skills/strict-goal/SKILL.md`
- 自然言語指示・`/strict-goal` コマンドのトリガー定義
- 人語のゴールから適切なパイプライン（新規機能なら `design` → `plan` → `implement` の自動連鎖、部分タスクなら単体モード）を自動判定するプロトコル
- ユーザーに経過を伝える進捗ダッシュボード（Roundごとの点数・must_fix・次アクションの日本語要約表示）
- エージェントが途中で諦めず、サーバーが `FINAL` を返すまで `must_fix` を解消し続ける自律ループ手順

#### [NEW] `.agents/skills/goal/SKILL.md` & `.claude/skills/goal/SKILL.md`
- `/goal <指示>` を実行した際、裏側で `strict-goal` ハーネスを自動起動するアダプター
- 通常の緩いプロンプト実行ではなく、ルーブリック・サーバー検証に裏打ちされた真の「ゴール完遂」を実現

#### [MODIFY] `strict-goal/skills/strict-goal/SKILL.md`
- 既存のテスト規約（7見出し・FINAL権威・絶対パス禁止）を100%維持しながら、人語指示からのタスク自動起票と3モード連鎖の自律駆動ガイダンスを強化

---

### 2. 軽量ヘルパーCLIツールの提供 (`strict-goal/helper.js`)

#### [NEW] `strict-goal/helper.js`
エージェントが `implement` モードで `artifact_commit` を呼ぶ際の最大の難所（ファイル集合の sha256 算出、テスト結果のカウント収集）を 1 コマンドで解決する軽量 Node スクリプト（外部依存なし）:
- `node strict-goal/helper.js fileset <path...>`: 指定ファイルの sha256 と manifest digest を JSON 出力
- `node strict-goal/helper.js test-run <command>`: テストコマンドを実行し、終了コード・出力 sha256・テスト数を `test_inventory` 形式で出力
- エージェントはツール呼び出し前にこのヘルパーを実行するだけで、正確な `artifact_commit` / `score_submit` パラメータを瞬時に得られる。

---

### 3. テスト・整合性修正

#### [MODIFY] `strict-goal/server/test/smoke.test.js` 等
- 先日のリネーム（rubric-loop → strict-goal）で残っていた参照の不整合を修正し、テストスイートの健全性を回復

---

## ユーザー体験イメージ (User Experience)

### パターン 1: スラッシュコマンド
```
/goal ユーザー認証APIにレートリミット機能を追加し、単体テストを完備する
```
または
```
/strict-goal ユーザー認証APIにレートリミット機能を追加し、単体テストを完備する
```

### パターン 2: 自然言語での指示
```
strict-goal で、ユーザー認証APIにレートリミット機能を追加して。
```

### エージェントの応答・自律実行フロー:
1. **受付**:
   ```
   🎯 [strict-goal] 目標を受け付けました: ユーザー認証APIにレートリミット機能を追加
   📋 連鎖パイプライン:
      1. [design] 設計書策定 & ルーブリック検証 (目標: FINAL)
      2. [plan] タスクDAG・受け入れ基準策定 (目標: FINAL)
      3. [implement] 実装・テスト検証 (目標: FINAL)
   ```
2. **自律ループ実行 (Phase 1: design)**:
   - `loop_open` (mode: create, loop_mode: design)
   - `artifact_commit` (設計Markdown)
   - `score_submit` (自己採点・エビデンス提出)
   - サーバー判定 `ITERATING` → must_fix を反映して周回 → サーバー判定 `FINAL`
3. **自動下流連鎖 (Phase 2: plan → Phase 3: implement)**:
   - 前フェーズの digest を自動ピン留めして次セッションを開き、FINAL まで完遂
4. **完了報告**:
   - 全フェーズ合格・テスト全件パス・監査ログ（audit）出力結果を提示

---

## 検証計画 (Verification Plan)

### 自動テスト
- `node --test strict-goal/server/test/skill_md.test.js` (スキル仕様適合性)
- `node --test strict-goal/server/test/smoke.test.js` (全体スモーク)
- ヘルパースクリプトの単体動作確認（fileset 生成、テスト結果パース）

### エンドツーエンド検証
- 実際に `/strict-goal` または人語プロンプトを用いて、ミニサンプル課題（例: 数値計算ユーティリティの作成とテスト）を `design` → `plan` → `implement` で実行し、`FINAL` まで自律的に到達することを確認。
