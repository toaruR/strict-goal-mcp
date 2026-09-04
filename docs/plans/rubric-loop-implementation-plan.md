UNVERIFIED-COMPLETE: rubric-loop server unavailable

# rubric ループ実行 MCP サーバ 実装計画

この Markdown は監査用の添付であり、判定対象は `docs/plans/rubric-loop-implementation-plan.json` のみである（設計書 19.5.2）。内容は JSON と同一で、人間が読む順に並べ替えてある。

rubric ループ実行 MCP サーバが利用できない状態で作成したため、本計画は機械判定を受けていない。「マージしてよい」「実装に着手してよい」とは主張しない（設計書 10.3）。

- 上流: `docs/design-rubric-loop-mcp.md`（v1.0.0 rev.4）
- `plan_version`: 1
- タスク数: 76（T001–T076）

## サマリ

UNVERIFIED-COMPLETE: rubric-loop server unavailable。本計画は設計書 v1.0.0 rev.4 を唯一の上流として、Agent Plugins 1.0.0 可搬パッケージ rubric-loop/ を76 タスクに分解した実装計画である。ツールは 7 本のまま増やさず、3 モード対応は引数の追加で表現する。順序は、後から差し替えると波及が最大になるもの（ホスト差の吸収・PLUGIN_DATA 解決・原子的書き込みとロック・MCP 2026-07-28 のステートレス前提）を T001 から T020 に前倒しし、以降を 7 ツール・連鎖・監査・スキルの順に積む。各タスクは単独でビルド可能かつテスト緑を保ち、途中で停止しても壊れた状態が残らないように分割してある。rubric ループのサーバが不在のため本計画は機械判定を受けておらず、マージ可否や実装着手可否は主張しない。

## 置いた仮定

- 本計画は rubric ループ実行 MCP サーバの設計書 v1.0.0 rev.4 のみを上流とする。rev.3 に対して差し戻した設計書側の欠陥 KB-1 から KB-7 は rev.4 ですべて解消されたため、本計画は rev.4 の記述をそのまま実装対象とする。差し戻しの記録と解消結果は併載の Markdown 末尾の KICKBACK 節に残してある。設計書と本計画が今後食い違う場合は本計画を直す。
- design_refs の表記は設計書の見出し行から先頭の # を除いた文字列そのものとした。設計書 19.5.2 の照合規則が正規化後の部分一致であるため、この表記は節番号形式（例: 6.4.1）でも見出し全文でも一致する。
- 設計書 1.3 のスコープ外に触れないため、.gitignore・CI 設定・配布スクリプト・レンダリング設定はどのタスクの changes にも含めていない。パッケージに置くファイルは 9.1 の構成図に現れるもの（plugin.json / mcp.json / skills/ / presets/ / server/）と、その実装およびテストのみである。
- 実装先のパッケージルートはリポジトリ直下の rubric-loop/ とした。設計書 9.1 の構成図がパッケージルートを rubric-loop/ と書いているため、それをそのままディレクトリ名に採用した。
- サーバ実装言語は Node.js とした。設計書 9.3 の mcp.json が command:"node" と args:["${PLUGIN_ROOT}/server/main.js"] を実物として固定しているため、他の選択肢は取れない。
- テストランナーは Node.js 標準の node --test とした。設計書は特定のテストフレームワークを指定しておらず、追加依存を持ち込まないことがスコープ外（1.3）の配布・CI に触れない唯一の選択であるため。
- rev.3 の時点で置いていた仮定のうち2件は、rev.4 で設計書側に規定されたため仮定ではなくなった。(1) streamable-http 版のファイル名は 9.1 と 9.4 が mcp.http.json と定め、既定は mcp.json、切り替えは利用者のリネームであることも規定された。(2) boot_id の取得は 8.4 が OS 起動識別子 / 起動時刻の UUIDv5 / instance_id 代用の3経路と boot_id_source の記録を規定した。どちらも設計書の規定をそのまま採り、本計画側で選び直していない。
- 実装不要: 「rubric ループ実行 MCP サーバ 設計書」— 文書のタイトル行であり実装対象を持たない。
- 実装不要: 「目次」— 文書内ナビゲーションであり実装対象を持たない。
- 実装不要: 「14. セルフホスティング検証：この設計書自身をこのツール列で作る」およびその小節「14.1 トレースで見つかった穴と、設計へ反映した修正」「14.2 回ることの確認（穴が無いこと）」「14.3 3モードでのセルフホスティング（この改訂作業そのもの）」「14.3.1 design モード — この改訂を回す」「14.3.2 plan モード — 実装計画を回す」「14.3.3 回らなかった箇所と、それを受けて直したこと」「14.3.4 この改訂に実際に走らせた機械検査（auto 基準の根拠の実物）」— 設計書自身を検証した記録であり、成果物側に実装すべき機能を含まない。ここで見つかった穴の反映結果は 6.4.3 の addresses と 6.4.1 のハンドル発行として本計画の T026 と T021 に入っている。
- 実装不要: 「15. 却下した代替案」— 採用しなかった設計の記録であり、実装対象を持たない。
- 実装不要: 「20. 改訂履歴」およびその小節「20.1 この改訂で足したもの（新規）」「20.2 この改訂で**変えた**もの（既存の決定の変更）」「20.3 この改訂で**変えなかった**もの（意図的に維持）」「20.4 既存の表への反映漏れが無いことの確認」「20.5 rev.4 — 下流（実装計画）からの差し戻し（KICKBACK）7件の反映」— 版管理の記録であり実装対象を持たない。20.2 が指す冪等性と ULID ハンドルの変更は本計画の T018 と T021 に入っている。
- 設計書 7.1 のアルゴリズム擬似コード内にある「入力: submitted[] ...」「既定値: pass_score=9, ...」の3行は、Markdown の見出し記法に見えるがコードフェンス内のコメント行であり節ではない。被覆の母集合から除外し、内容は T035 と T020 で実装対象にした。
- 設計書 10.2 の SKILL.md 実物はコードフェンス内にあり、その中の見出し（原則 / モードの選び方 / 手順 / 上流が変わったと言われたら / 上流が間違っていると気づいたら / 文脈を失ったとき / ツールが使えないとき（縮退））は成果物 SKILL.md の節そのものである。T048 と T049 で実装対象にした。
- 各タスクは単独で「ビルド可能かつテスト緑」を保つ。76 タスクのうち 74 タスクは changes が add のみで、取り消しは追加ファイルの削除で足りる。add 以外を含むのは T049（SKILL.md に縮退節を追記）と T076（server/package.json の scripts に test を追記）の2件だけで、いずれも追記行の削除で元に戻る。delete を含むタスクは0件である。
- ロールバック手順は次で統一する。(1) タスク単位で1コミットにする。(2) 取り消しは git revert <そのタスクのコミット> で行う。(3) revert 後に node --test rubric-loop/server/test を流し、直前のタスクまでの受け入れ条件がすべて緑であることを確認する。例外は T048 と T049 で、SKILL.md を2回に分けて書くため T049 だけを revert しても SKILL.md は妥当な Markdown として成立するが、縮退規約（10.3）が失われるので AT-9 と AT-18 のテストが赤になる。この2件は同時に revert する。
- T001 から T020 までを先に置いたのは、ホスト差の吸収（11）・PLUGIN_DATA 解決（8.2）・原子的書き込みとロック（8.4）・MCP 版差（18）が、後から差し替えると全モジュールに波及して手戻りが最大になるためである。依存関係が許す最も早い位置に固めた。
- 実装順を途中で止めた場合、T020 までで「起動して server/discover と tools/list に答えるが、どのツールもまだ無い」状態、T025 までで「セッションを開いて状態を読めるが採点できない」状態、T038 までで design モードが完結した状態、T047 までで3モードと監査が完結した状態になる。いずれの段階でも既存テストは緑のままである。
- 設計書 1.3 のスコープ外（CI 設定・配布・レンダリング）に該当する作業はタスクに含めていない。T074 はスコープ外物が混入していないことを検査するタスクであり、スコープ外の作業そのものではない。

## フェーズ0: 基盤とホスト差の吸収（T001–T020）

後から差し替えると全モジュールに波及する項目を先に固める。ここが終わった時点で、サーバは起動して server/discover と tools/list に答えるが、ツールの中身はまだ無い。

### T001 可搬パッケージ骨格と plugin.json を置く

**狙い**: Agent Plugins 1.0.0 の可搬パッケージとして発見される最小形を先に固定する。コンポーネントは skills/ と mcp.json の2種のみで、server/ と presets/ は付属物として扱う。ここが固まらないと以降のパス解決が全部やり直しになるため最初に置く。

**設計書参照**: `9. 可搬パッケージ（実物）` / `9.1 パッケージ構成` / `9.2 `plugin.json`（実物）` / `1. 前提（置いた仮定を含む）` / `1.1 動かせない前提`

**依存**: なし（起点）

**変更**:

- `rubric-loop/plugin.json` (add)  — $schema と name のみ必須。version 1.0.0 / license MIT を併記
- `rubric-loop/server/package.json` (add)  — name rubric-loop-server, type module, private true, engines node>=20
- `rubric-loop/server/test/package_layout.test.js` (add)  — 骨格の存在と plugin.json の形を検査

**受け入れ条件**:

- rubric-loop/plugin.json が JSON として読め、$schema が https://agent-plugins.org/schemas/v1.0.0/plugin.json、name が rubric-loop であること
- plugin.json に資格情報（token, key, secret, password を名に含むキー）が1個も無いこと
- rubric-loop/server/package.json の type が module であること
- コンポーネントとして発見されるのは skills/ と mcp.json だけで、presets/ と server/ は plugin.json に列挙されないこと

**検証コマンド**:

- `jq -e '.name=="rubric-loop" and .["$schema"]=="https://agent-plugins.org/schemas/v1.0.0/plugin.json"' rubric-loop/plugin.json` → 終了コード 0（plugin.json の実物一致）
- `node --test rubric-loop/server/test/package_layout.test.js` → 終了コード 0

**見積**: 1 周

### T002 PLUGIN_ROOT の解決順序とベンダー別名の吸収を実装する

**狙い**: RUBRIC_LOOP_ROOT / CLAUDE_PLUGIN_ROOT / PLUGIN_ROOT / argv0 由来 / 未解決 の5段の解決順序と、1と2が異値のときの root_conflict 警告を実装する。ホスト差の吸収はほぼ全モジュールの前提になるので依存関係が許す最速で置く。

**設計書参照**: `11. ホスト差の吸収` / `11.1 `PLUGIN_ROOT` の解決順序` / `11.2 ベンダー固有前提を持ち込まない境界`

**依存**: T001

**変更**:

- `rubric-loop/server/src/paths/plugin_root.js` (add)  — resolvePluginRoot(env, argv1) -> {root, source, warnings}
- `rubric-loop/server/test/plugin_root.test.js` (add)  — 5段の順序と conflict/unresolved を検査

**受け入れ条件**:

- RUBRIC_LOOP_ROOT が設定されていればそれを採用し plugin_root_source が "PLUGIN_ROOT" になること
- RUBRIC_LOOP_ROOT と CLAUDE_PLUGIN_ROOT が異値のとき 1 を採用し warnings に root_conflict: RUBRIC_LOOP_ROOT=<a> CLAUDE_PLUGIN_ROOT=<b> using=<a> が出ること
- env が1つも無いとき server/main.js の親の親を root とし plugin_root_source が "argv0" になること
- どれも解決できないとき起動は継続し、preset 読み込みのみ無効化して warnings に root_unresolved が出ること
- mcp.json 以外の場所でも ${CLAUDE_PLUGIN_ROOT} を展開せず、別名吸収はサーバ内 env 解決だけで行うこと

**検証コマンド**:

- `node --test rubric-loop/server/test/plugin_root.test.js` → 終了コード 0

**見積**: 2 周

### T003 PLUGIN_DATA の解決順序と EPHEMERAL 縮退を実装する

**狙い**: RUBRIC_LOOP_DATA / CLAUDE_PLUGIN_DATA / XDG_STATE_HOME/rubric-loop / ~/.local/state/rubric-loop（Windows は %LOCALAPPDATA%\rubric-loop）/ EPHEMERAL の5段を実装し、EPHEMERAL では loop_open を E_NO_PERSISTENCE で拒否する（allow_ephemeral:true のときのみ許す）。縮退経路の要なので前倒しする。

**設計書参照**: `8. 状態の外部化（永続層）` / `8.2 PLUGIN_DATA の解決順序と縮退`

**依存**: T001

**変更**:

- `rubric-loop/server/src/paths/plugin_data.js` (add)  — resolvePluginData(env, argv) -> {dir, mode: persistent|ephemeral, warnings}
- `rubric-loop/server/test/plugin_data.test.js` (add)  — 5段と data_dir_conflict と EPHEMERAL を検査

**受け入れ条件**:

- RUBRIC_LOOP_DATA と CLAUDE_PLUGIN_DATA が異値のとき 1 を採用し warnings に data_dir_conflict が出ること
- 書き込み可能な候補が1つも無いとき mode が "ephemeral" になり、状態はメモリ上のみになること
- mode が "ephemeral" のとき allow_ephemeral 未指定の loop_open が E_NO_PERSISTENCE を返すこと
- mode が "ephemeral" かつ allow_ephemeral:true の loop_open は成功し、応答の warnings に ephemeral が含まれること
- 解決したディレクトリ配下に rubric-loop/ を作り、以後の全パスがその下に閉じること

**検証コマンド**:

- `node --test rubric-loop/server/test/plugin_data.test.js` → 終了コード 0

**見積**: 2 周

### T004 原子的書き込み（tmp→fsync→rename→dir fsync）を実装する

**狙い**: 永続層の全書き込みを write(tmp) -> fsync -> rename -> fsync(dir) の順で行うユーティリティにまとめ、途中終了で壊れた JSON が残らないことを保証する。以降の全永続タスクがこの1関数に乗るため先に置く。

**設計書参照**: `8.4 書き込みの原子性と並行性` / `8.1 ディレクトリ構成`

**依存**: T003

**変更**:

- `rubric-loop/server/src/store/atomic.js` (add)  — writeAtomic(path, bytes) と readJson/writeJson
- `rubric-loop/server/test/atomic.test.js` (add)  — tmp 残骸なし・rename 後に完全な内容が読めることを検査

**受け入れ条件**:

- writeAtomic 完了後、対象パスに書いた全バイトが読み出せること
- writeAtomic の途中で失敗させても、対象パスは旧内容のままか存在しないかのどちらかで、部分書き込みが観測されないこと
- 書き込み後に *.tmp が同ディレクトリに残っていないこと
- rename 後にディレクトリ fsync を呼んでいること（fs 呼び出しのスパイで確認）

**検証コマンド**:

- `node --test rubric-loop/server/test/atomic.test.js` → 終了コード 0

**見積**: 2 周

### T005 排他ロック LOCK と boot_id の3経路取得、60 秒の陳腐化回収、E_CONCURRENT を実装する

**狙い**: O_EXCL で LOCK を作り {pid, boot_id, boot_id_source, acquired_at} を書く。boot_id は 8.4 の3経路（OS の起動識別子 / 起動時刻を丸めた UUIDv5 / PLUGIN_DATA 直下の instance_id による代用）で求め、採った経路を boot_id_source に記録する。代用経路では陳腐化判定を acquired_at からの 60 秒経過のみに縮退させる。取得できなければ E_CONCURRENT を返す。並行破壊は復旧が高くつくので早期に潰す。セッションの取り違えと並行上書き（F12）をここで塞ぐ。

**設計書参照**: `8.4 書き込みの原子性と並行性` / `8.1 ディレクトリ構成`

**依存**: T004

**変更**:

- `rubric-loop/server/src/store/boot_id.js` (add)  — resolveBootId(env, platform) -> {boot_id, boot_id_source}。source は os / instance の2値
- `rubric-loop/server/src/store/lock.js` (add)  — acquireLock/releaseLock。stale_ms=60000 固定
- `rubric-loop/server/test/lock.test.js` (add)  — 二重取得の拒否・60 秒回収・boot_id 3経路と縮退を検査

**受け入れ条件**:

- LOCK が存在しないとき acquireLock が成功し、LOCK に pid と boot_id と boot_id_source と acquired_at の4キーが書かれること
- /proc/sys/kernel/random/boot_id が読めるホストではその値を boot_id とし boot_id_source が "os" になること
- 起動識別子が無く起動時刻だけ取れるホストでは now-uptime を秒精度 ISO 8601 に丸めた文字列の UUIDv5 を boot_id とし、同一起動中に2回呼んでも同値になること
- どちらも取れないとき PLUGIN_DATA 直下の instance_id を読み（無ければ UUIDv4 を生成して原子的に作成し）boot_id_source が "instance" になること
- boot_id_source が "instance" のとき pid の生存確認を陳腐化判定に使わず、acquired_at からの 60 秒経過のみで判定し、応答の warnings に lock_staleness_time_only が入ること
- boot_id_source が異なる2つの LOCK を比較するとき同一 boot_id とみなさず、時間のみで陳腐化を判定すること
- boot_id の経路が起動時に1度だけ決まり、同一プロセス内で後から変わらないこと
- LOCK 保持中に別プロセスが acquireLock すると E_CONCURRENT が返ること
- acquired_at が現在時刻より 60000 ミリ秒以上前の LOCK は回収され、取得が成功すること
- acquired_at が 59000 ミリ秒前の LOCK は回収されず E_CONCURRENT になること
- releaseLock 後に LOCK ファイルが消えていること

**検証コマンド**:

- `node --test rubric-loop/server/test/lock.test.js` → 終了コード 0

**見積**: 3 周

### T006 正規化つき SHA-256 ダイジェストを実装する

**狙い**: UTF-8 NFC 化、CRLF を LF に変換、行末空白の除去、末尾改行1個に揃える、の順で正規化してから SHA-256 を取る関数を作る。artifact / rubric / evidence の同一性判定が全部これに乗るので基盤として先に固定する。

**設計書参照**: `16. 既定値まとめ（実装時に決め直さない）` / `5.3 版管理と「こっそり緩める」の監査`

**依存**: T001

**変更**:

- `rubric-loop/server/src/hash/digest.js` (add)  — normalize(text) と sha256Hex(text) と digestJson(obj)
- `rubric-loop/server/test/digest.test.js` (add)  — 正規化4段の等価性と既知ベクタを検査

**受け入れ条件**:

- CRLF 版と LF 版の同一文章が同じダイジェストになること
- 行末空白のみが異なる2文章が同じダイジェストになること
- 末尾改行が0個・1個・3個の同一文章が同じダイジェストになること
- NFD 合成前の文字列と NFC 正規化後の文字列が同じダイジェストになること
- sha256Hex("a\n") が sha256sum コマンドの出力と一致すること

**検証コマンド**:

- `printf 'a\n' | sha256sum` → 終了コード 0（同じ入力に対する外部基準値）
- `node --test rubric-loop/server/test/digest.test.js` → 終了コード 0

**見積**: 2 周

### T007 MCP 2026-07-28 の stdio トランスポートと server/discover を実装する

**狙い**: initialize ハンドシェイク無しで起動し、server/discover に protocolVersions:["2026-07-28","2025-11-25"] を返す stdio サーバを立てる。プロトコル版差はやり直しコストが最大なので、基盤の直後に置く。

**設計書参照**: `18. MCP 2026-07-28（ステートレス改訂）への適合` / `18.1 改訂の要点と本設計の対応` / `18.2 「ステートレスになった」ことと本設計の関係` / `9.3 `mcp.json`（実物・stdio 既定）`

**依存**: T002, T003

**変更**:

- `rubric-loop/server/main.js` (add)  — --data-dir を受け、stdio で JSON-RPC を読み書きする入口
- `rubric-loop/server/src/mcp/transport_stdio.js` (add)  — 改行区切り JSON-RPC の送受信
- `rubric-loop/server/src/mcp/discover.js` (add)  — server/discover ハンドラ
- `rubric-loop/mcp.json` (add)  — type stdio / command node / args ${PLUGIN_ROOT}/server/main.js --data-dir ${PLUGIN_DATA} / cwd ${PLUGIN_DATA}
- `rubric-loop/server/test/discover.test.js` (add)  — discover 応答と initialize 非依存を検査

**受け入れ条件**:

- initialize を一度も送らずに server/discover を呼んで結果が返ること
- server/discover の結果の protocolVersions が ["2026-07-28","2025-11-25"] の順で返ること
- Mcp-Session-Id 相当のヘッダやプロトコルセッション識別子を一切要求せず、送られても無視すること
- mcp.json の command が単一の実行トークン "node" であること
- mcp.json 内で展開される変数が ${PLUGIN_ROOT} と ${PLUGIN_DATA} の2種のみであること
- mcp.json の cwd が ${PLUGIN_DATA} であり、PLUGIN_ROOT / PLUGIN_DATA の外を指さないこと

**検証コマンド**:

- `jq -e '.mcpServers["rubric-loop"].type=="stdio" and .mcpServers["rubric-loop"].command=="node"' rubric-loop/mcp.json` → 終了コード 0
- `node --test rubric-loop/server/test/discover.test.js` → 終了コード 0

**見積**: 3 周

### T008 tools/list の決定的順序と結果キャッシュ指示を実装する

**狙い**: tools/list が常に loop_open, loop_state, artifact_commit, score_submit, rubric_amend, escalate, audit_export の固定順で7本だけを返し、CacheableResult として ttlMs 86400000 / cacheScope private を付ける。ツール表面の本数固定をここで機械的に固める。

**設計書参照**: `6.1 一覧（7ツール・直交）` / `18.1 改訂の要点と本設計の対応` / `19.6 ツール表面（3モード対応後）` / `19.6.2 全ツール一覧（3モード対応後）` / `19.6.1 結論: **新規ツールは1本も追加しない**`

**依存**: T007

**変更**:

- `rubric-loop/server/src/mcp/tools_list.js` (add)  — 固定配列を返す。ttlMs 86400000 / cacheScope private
- `rubric-loop/server/test/tools_list.test.js` (add)  — 本数7・順序・キャッシュ指示を検査

**受け入れ条件**:

- tools/list が返すツールがちょうど7本であること
- 順序が loop_open, loop_state, artifact_commit, score_submit, rubric_amend, escalate, audit_export で固定であること
- 同じ入力に対して2回呼んだ結果が完全一致すること（決定的順序）
- 結果に ttlMs:86400000 と cacheScope:"private" が付くこと
- 3モード対応後もツールが8本以上に増えていないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/tools_list.test.js` → 終了コード 0

**見積**: 2 周

### T009 streamable-http 版のひな型 mcp.http.json と transport 非依存を実装する

**狙い**: url http://127.0.0.1:8971/mcp の streamable-http 版を 9.4 の規定どおり mcp.http.json というひな型として同梱し、既定の transport 宣言は固定位置の mcp.json（stdio）のままにする。切り替えは利用者のリネーム操作だけで済ませ、サーバ本体は transport を知らずに同じツール実装を提供する。レガシー SSE には依存しない。

**設計書参照**: `9.4 `mcp.http.json`（streamable-http 版のひな型）` / `9.5 transport 差への非依存` / `11.3 transport 差`

**依存**: T008

**変更**:

- `rubric-loop/mcp.http.json` (add)  — streamable-http 版。headers キーを持たない
- `rubric-loop/server/src/mcp/transport_http.js` (add)  — streamable-http の受け口。SSE 再開に依存しない
- `rubric-loop/server/test/transport.test.js` (add)  — 同一ツール実装が両 transport で同じ結果を返すことを検査

**受け入れ条件**:

- mcp.http.json の url が http://127.0.0.1:8971/mcp であること
- mcp.http.json に headers キーが存在しないこと（資格情報を置く場所を作らない）
- mcp.http.json を同梱した状態でも既定の transport 宣言は mcp.json（stdio）のままで、mcp.http.json はコンポーネントとして発見されないこと
- streamable-http への切り替えが mcp.json の退避と mcp.http.json のリネームだけで完了し、実行時に transport を選ぶ分岐がサーバ側に1件も無いこと
- 同一のツール呼び出しが stdio と streamable-http で同一の結果 JSON を返すこと
- SSE のストリーム再開 API を1箇所も参照していないこと（ソース grep で 0 件）
- ツール実装モジュールが transport 実装を import する行が0件であること（依存の向きが一方向）

**検証コマンド**:

- `jq -e '.mcpServers["rubric-loop"].url=="http://127.0.0.1:8971/mcp" and (.mcpServers["rubric-loop"]|has("headers")|not)' rubric-loop/mcp.http.json` → 終了コード 0
- `grep -rn 'text/event-stream\|Last-Event-ID' rubric-loop/server/src` → 終了コード 1（SSE 再開への依存が0件であること）
- `grep -rn 'transport_stdio\|transport_http' rubric-loop/server/src/tools` → 終了コード 1（ツール層から transport 層への依存が0件であること）
- `node --test rubric-loop/server/test/transport.test.js` → 終了コード 0

**見積**: 2 周

### T010 エラーコード表（42件）を単一のレジストリに実装する

**狙い**: E_STATE_VIOLATION / E_SESSION_NOT_FOUND / E_CONCURRENT / E_VALIDATION / E_NO_PERSISTENCE / E_INTERNAL の共通6件と、19.6.6 の追加分を含む全42件を1ファイルに集約し、-32020 から -32099 の予約帯を使わず structuredContent.error.code に文字列で載せる。

**設計書参照**: `6.3 共通エラー条件` / `19.6.6 追加エラーコード` / `19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）` / `18.1 改訂の要点と本設計の対応`

**依存**: T008

**変更**:

- `rubric-loop/server/src/errors/codes.js` (add)  — 42件の定数と detail の形。E_INTERNAL は最後の受け皿
- `rubric-loop/server/src/errors/envelope.js` (add)  — structuredContent.error.{code,message,detail} への詰め替え
- `rubric-loop/server/test/error_codes.test.js` (add)  — 42件の存在・重複なし・予約帯不使用を検査

**受け入れ条件**:

- レジストリが公開するエラーコードがちょうど42件で、重複が0件であること
- E_STATE_VIOLATION, E_SESSION_NOT_FOUND, E_CONCURRENT, E_VALIDATION, E_NO_PERSISTENCE, E_INTERNAL の6件が含まれること
- 全エラーが JSON-RPC の -32020 から -32099 を使わず、structuredContent.error.code に文字列として現れること
- 想定外の例外はすべて E_INTERNAL に落ち、スタックトレースを応答に含めないこと
- E_STATE_VIOLATION が detail.expected_tools を持つこと
- 19.6.7 の総覧が定める「共通エラー条件を含む全数（E_INTERNAL のみ除外）」の割り当てに従い、E_VALIDATION が7ツールすべてに割り当てられていること
- ツール別の割り当て件数が 19.6.7 の総覧と一致すること（loop_open 13 / loop_state 2 / artifact_commit 13 / score_submit 19 / rubric_amend 5 / escalate 7 / audit_export 2、いずれも E_INTERNAL を除く）

**検証コマンド**:

- `node --test rubric-loop/server/test/error_codes.test.js` → 終了コード 0
- `node -e "const c=require('./rubric-loop/server/src/errors/codes.js');process.exit(Object.keys(c.CODES).length===42?0:1)"` → 終了コード 0（コード数42の機械確認）

**見積**: 2 周

### T011 共通出力エンベロープと next_action を実装する

**狙い**: 全ツール応答に resultType と session_id / state / round / next_action / warnings を持つ共通エンベロープを被せる。next_action が次に呼ぶツール名と入力の骨格を返すことで、周回中にループを忘れる失敗（F2）を塞ぐ。

**設計書参照**: `6.2 共通の出力エンベロープ` / `18.1 改訂の要点と本設計の対応` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T010

**変更**:

- `rubric-loop/server/src/mcp/envelope.js` (add)  — resultType 必須。next_action{tool, input_skeleton} を必ず埋める
- `rubric-loop/server/test/envelope.test.js` (add)  — resultType 必須・next_action 常時同梱を検査

**受け入れ条件**:

- 成功・失敗を問わず全ツール応答に resultType が存在すること
- 終端状態（FINAL, FINAL_WITH_RELAXATION, ABORTED）以外の全応答に next_action が存在すること
- next_action.tool が7ツールのいずれかであること
- session_id が rl_ 前置の ULID 形式であること
- warnings が常に配列であること（警告が無いときは空配列）

**検証コマンド**:

- `node --test rubric-loop/server/test/envelope.test.js` → 終了コード 0

**見積**: 2 周

### T012 ツール入出力 JSON Schema と検証器を実装する

**狙い**: 6.4 の入出力スキーマ実物をファイルとして持ち、draft 2020-12 のうち本設計が使う語彙（type, enum, required, additionalProperties, pattern, minItems, minimum, maximum, minLength, maxLength, uniqueItems）だけを解釈する検証器を実装して E_VALIDATION を返す。

**設計書参照**: `6.4 ツール定義（入力／出力 JSON Schema 実物）` / `6. ツール表面`

**依存**: T010

**変更**:

- `rubric-loop/server/src/schema/validate.js` (add)  — 必要語彙のみの検証器。違反は E_VALIDATION に detail.path 付き
- `rubric-loop/server/schemas/tools.json` (add)  — 7ツールの入出力スキーマ実物
- `rubric-loop/server/test/schema_validate.test.js` (add)  — 各語彙の受理・拒否と additionalProperties を検査

**受け入れ条件**:

- required キー欠落が E_VALIDATION になり detail.path に欠落キー名が入ること
- additionalProperties:false のオブジェクトに未知キーを入れると E_VALIDATION になること
- pattern 違反・minItems 違反・minLength 違反・uniqueItems 違反がそれぞれ E_VALIDATION になること
- server/schemas/tools.json が7ツール分の入力と出力のスキーマを持つこと
- 検証器が未対応語彙に遭遇したら黙って通さず E_INTERNAL を投げること

**検証コマンド**:

- `jq -e '[.tools|keys[]]|length==7' rubric-loop/server/schemas/tools.json` → 終了コード 0
- `node --test rubric-loop/server/test/schema_validate.test.js` → 終了コード 0

**見積**: 3 周

### T013 index.json と session.json の永続構造を実装する

**狙い**: PLUGIN_DATA/rubric-loop/ 直下の index.json（session_id -> {state, round, updated_at}、label 逆引き、chain_id 逆引き）と sessions/<session_id>/session.json を 8.3 の実物どおりに読み書きする。

**設計書参照**: `8.1 ディレクトリ構成` / `8.3 `session.json`（実物）` / `8.5 再開が「モデルの記憶に依存しない」ことの担保`

**依存**: T005, T006

**変更**:

- `rubric-loop/server/src/store/session_store.js` (add)  — session.json の読み書きと index.json の更新を1トランザクションで
- `rubric-loop/server/src/store/index_store.js` (add)  — label 逆引きと chain_id 逆引き
- `rubric-loop/server/test/session_store.test.js` (add)  — 往復・逆引き・原子性を検査

**受け入れ条件**:

- session.json を書いた直後に読み戻すと全フィールドが一致すること
- index.json に session_id -> {state, round, updated_at} が反映されること
- 同じ label を持つセッションが複数あるとき label 逆引きが候補配列を返すこと
- chain_id 逆引きが同一チェーンの全 session_id を返すこと
- session.json の書き込みが writeAtomic 経由であること（直接 writeFile を呼ばない）
- session.json に server.plugin_root_source が記録されること

**検証コマンド**:

- `node --test rubric-loop/server/test/session_store.test.js` → 終了コード 0
- `grep -rn 'writeFileSync\|fs.writeFile' rubric-loop/server/src/store/session_store.js` → 終了コード 1（原子的書き込み以外を使っていないこと）

**見積**: 2 周

### T014 状態機械と呼べる／呼べないツールの表を実装する

**狙い**: DRAFTING / SCORING / STALLED / ESCALATED / FINAL / FINAL_WITH_RELAXATION / ABORTED / SUPERSEDED / FROZEN の9状態と、状態ごとの許可ツール表を単一の表データとして持ち、違反を E_STATE_VIOLATION（detail.expected_tools 付き）で弾く。

**設計書参照**: `0. 用語` / `4. 状態機械` / `4.1 状態遷移図` / `4.2 状態ごとの呼べる／呼べないツール` / `19.9 状態機械（3モード共通 + モード固有状態）` / `19.9.2 状態ごとに呼べるツール（改訂後・全状態）` / `19.9.1 判断: 状態機械は**共通**`

**依存**: T011, T013

**変更**:

- `rubric-loop/server/src/fsm/states.js` (add)  — 9状態と許可ツールの表
- `rubric-loop/server/src/fsm/guard.js` (add)  — 呼び出し入口のガード。違反は E_STATE_VIOLATION
- `rubric-loop/server/test/fsm.test.js` (add)  — 全状態×全ツールの許可行列を全数検査

**受け入れ条件**:

- 設計書 0 の用語（state / verdict / round / artifact / evidence / rubric / chain / relaxation）が、そのままコード上の識別子名として使われ、別名や訳語が導入されていないこと
- 9状態×7ツールの63通りすべてについて、許可／拒否が設計書の表と一致すること
- DRAFTING で score_submit を呼ぶと E_STATE_VIOLATION になり detail.expected_tools に artifact_commit が含まれること
- SCORING で artifact_commit と rubric_amend が拒否されること
- FINAL では loop_state と audit_export だけが通り、escalate も拒否されること
- loop_state と audit_export が全9状態で常に通ること

**検証コマンド**:

- `node --test rubric-loop/server/test/fsm.test.js` → 終了コード 0

**見積**: 3 周

### T015 モード固有状態の構造的到達不能性を検査可能にする

**狙い**: loop_mode:"design" のセッションでは SUPERSEDED と FROZEN に至る遷移辺が存在しないことを、状態機械の表から機械的に導けるようにする。到達可能性を実行時ではなく表の探索で示す。

**設計書参照**: `19.9.3 モード固有状態の到達不能性（構造的保証）` / `4.3 ラウンド番号の進み方`

**依存**: T014

**変更**:

- `rubric-loop/server/src/fsm/reachability.js` (add)  — 開始状態とモードから到達可能状態集合を計算する
- `rubric-loop/server/test/reachability.test.js` (add)  — design モードで SUPERSEDED/FROZEN が到達不能であることを検査

**受け入れ条件**:

- loop_mode:"design" の到達可能状態集合に SUPERSEDED と FROZEN が含まれないこと
- loop_mode:"plan" と "implement" の到達可能状態集合には両方が含まれること
- round が ITERATING のときだけ +1 され、拒否された提出では進まないこと
- 到達可能性の計算が実行時状態ではなく状態遷移表のみを入力とすること

**検証コマンド**:

- `node --test rubric-loop/server/test/reachability.test.js` → 終了コード 0

**見積**: 2 周

### T016 rubric スキーマと content-addressed な版管理を実装する

**狙い**: criteria[] の id / weight / verification / anchors と policy を持つ rubric スキーマを実装し、正規化 SHA-256 で rubric_digest を確定して rubric/<version>.json に保存する。基準は最大40件。

**設計書参照**: `5. rubric スキーマ` / `5.1 構造` / `5.2 フィールド定義`

**依存**: T012, T013

**変更**:

- `rubric-loop/server/src/rubric/schema.js` (add)  — rubric の JSON Schema。criteria maxItems 40
- `rubric-loop/server/src/rubric/store.js` (add)  — rubric/<version>.json への保存と digest 確定
- `rubric-loop/server/test/rubric_schema.test.js` (add)  — 必須欄・上限・digest 安定性を検査

**受け入れ条件**:

- criteria が41件のとき E_VALIDATION になり、40件は通ること
- criterion の verification が auto または manual のいずれかに限られること
- 同一内容の rubric を2回保存すると rubric_digest が一致すること
- rubric/1.json が保存され、版番号が1から始まること
- policy に pass_score, pass_weighted_mean, max_rounds, stall_window, stall_epsilon, max_score_jump が含まれること

**検証コマンド**:

- `node --test rubric-loop/server/test/rubric_schema.test.js` → 終了コード 0

**見積**: 2 周

### T017 rubric_amend の緩和分類と E_THRESHOLD_IMMUTABLE を実装する

**狙い**: 版差分を stricter / neutral / relaxation に分類し、重み減・基準削除・アンカー緩和を relaxation として rubric_diff/<version>.json に記録する。閾値そのものの変更は E_THRESHOLD_IMMUTABLE で拒否する。基準を後から緩める失敗（F4）をここで塞ぐ。

**設計書参照**: `5.3 版管理と「こっそり緩める」の監査` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T016

**変更**:

- `rubric-loop/server/src/rubric/diff.js` (add)  — 3分類の判定と rubric_diff/<v>.json の生成
- `rubric-loop/server/test/rubric_diff.test.js` (add)  — 3分類の境界と閾値不変を検査

**受け入れ条件**:

- 重みを下げる変更が relaxation に分類されること
- 基準を削除する変更が relaxation に分類されること
- アンカーの文言を緩める変更が relaxation に分類されること
- アンカーを厳しくする変更が stricter に分類されること
- pass_score / pass_weighted_mean / max_score_jump の変更が E_THRESHOLD_IMMUTABLE で拒否されること
- relaxation が1件でも記録されたセッションは relaxation_count が正になり FINAL に到達不能になること

**検証コマンド**:

- `node --test rubric-loop/server/test/rubric_diff.test.js` → 終了コード 0

**見積**: 2 周

### T018 submission_id による冪等性（手順0）を実装する

**狙い**: artifact_commit / score_submit / loop_open / rubric_amend / escalate に 8 から 128 文字の submission_id を必須化し、既出なら保存済み応答をそのまま返す。ストリーム再開が廃止された前提で再送が起きるため、二重採点（F14）をここで塞ぐ。

**設計書参照**: `18.1 改訂の要点と本設計の対応` / `7.1 判定アルゴリズム（`score_submit` の中核）` / `16. 既定値まとめ（実装時に決め直さない）`

**依存**: T013, T012

**変更**:

- `rubric-loop/server/src/idempotency/store.js` (add)  — submission_id -> 保存済み応答。セッション単位
- `rubric-loop/server/src/idempotency/guard.js` (add)  — 手順0として全 mutation ツールの先頭で適用
- `rubric-loop/server/test/idempotency.test.js` (add)  — 再送で状態が二重に進まないことを検査

**受け入れ条件**:

- submission_id が7文字のとき E_VALIDATION、8文字と128文字は通り、129文字は E_VALIDATION になること
- 同一 submission_id の score_submit を2回送っても round が1回しか進まないこと
- 2回目の応答が1回目とバイト単位で一致すること
- 冪等記録がセッション単位で分離され、別セッションの同名 submission_id と衝突しないこと
- loop_open, artifact_commit, score_submit, rubric_amend, escalate の5ツールで submission_id が必須であること

**検証コマンド**:

- `node --test rubric-loop/server/test/idempotency.test.js` → 終了コード 0

**見積**: 2 周

### T019 モード別 rubric プリセット3本を配置する

**狙い**: presets/design.json（15基準）、presets/plan.json、presets/implement.json を設計書の全文どおりに置き、${PLUGIN_ROOT}/presets/ から読む。PLUGIN_ROOT 未解決時は preset 読み込みのみ無効化する。

**設計書参照**: `19.7 モード別 rubric プリセット（実物）` / `19.7.1 `presets/design.json`（全文・15基準）` / `19.7.2 `presets/plan.json`（全文）` / `19.7.3 `presets/implement.json`（全文）`

**依存**: T016, T002

**変更**:

- `rubric-loop/presets/design.json` (add)  — 15基準。max_rounds 12 / stall_window 3 / stall_epsilon 0.25
- `rubric-loop/presets/plan.json` (add)  — 8基準。max_rounds 8 / stall_window 2 / stall_epsilon 0.25
- `rubric-loop/presets/implement.json` (add)  — max_rounds 16 / stall_window 4 / stall_epsilon 0.20
- `rubric-loop/server/src/rubric/presets.js` (add)  — ${PLUGIN_ROOT}/presets/<mode>.json を読む。未解決なら無効化
- `rubric-loop/server/test/presets.test.js` (add)  — 3本の値と auto 比率を検査

**受け入れ条件**:

- presets/design.json の criteria が15件であること
- presets/plan.json の policy が max_rounds 8 / stall_window 2 / stall_epsilon 0.25 であること
- presets/implement.json の policy が max_rounds 16 / stall_window 4 / stall_epsilon 0.20 であること
- verification:"auto" の基準の比率が design で 20 パーセント、plan で 50 パーセント、implement で 78 パーセントであること
- PLUGIN_ROOT が未解決のとき presets 読み込みが無効化され、loop_open が明示 rubric を要求すること

**検証コマンド**:

- `jq -e '.criteria|length==15' rubric-loop/presets/design.json` → 終了コード 0
- `jq -e '.policy.max_rounds==8 and .policy.stall_window==2 and .policy.stall_epsilon==0.25' rubric-loop/presets/plan.json` → 終了コード 0
- `jq -e '.policy.max_rounds==16 and .policy.stall_window==4 and .policy.stall_epsilon==0.20' rubric-loop/presets/implement.json` → 終了コード 0
- `node --test rubric-loop/server/test/presets.test.js` → 終了コード 0

**見積**: 3 周

### T020 既定値表を単一の定数モジュールに固定する

**狙い**: 16 の既定値まとめと 7.2 の根拠表にある値を1ファイルに集め、実装時に決め直さない。pass_score 9 / pass_weighted_mean 9.0 / max_rounds 12 / stall_window 3 / stall_epsilon 0.25 / max_score_jump 3 / extra_rounds 3 / rationale 40 文字 / change_note 20 文字 / artifact 1000000 バイト / criteria 40 件 / lock 60 秒 / fileset 5000 ファイル / path 1024 バイト / manifest 2 MB / plan 200 タスク / chain_max_rounds 28 / chain_extra_rounds 6 / chain_max_kickbacks 2 を含む。

**設計書参照**: `16. 既定値まとめ（実装時に決め直さない）` / `7.2 既定値と根拠` / `17. 未解決事項として残さないための注記` / `19.10.1 モード別の値と理由`

**依存**: T001

**変更**:

- `rubric-loop/server/src/config/defaults.js` (add)  — 全既定値。ここ以外にマジックナンバーを書かない
- `rubric-loop/server/test/defaults.test.js` (add)  — 既定値表の全項目を1件ずつ突き合わせる

**受け入れ条件**:

- scale が 1 から 10 の整数、pass_score が 9、pass_weighted_mean が 9.0 であること
- max_rounds がモード別に design 12 / plan 8 / implement 16、stall_window が 3 / 2 / 4、stall_epsilon が 0.25 / 0.25 / 0.20 であること
- max_score_jump が 3、extra_rounds が 3、chain_max_rounds が 28、chain_extra_rounds が 6、chain_max_kickbacks が 2 であること
- rationale の最小長が40文字、change_note の最小長が20文字、weakness が score<10 のとき必須であること
- artifact のサイズ上限が 1000000 バイト、criteria 上限が40件、plan のタスク上限が200件であること
- fileset の上限が 5000 ファイル / path 1024 バイト / manifest 2097152 バイトであること
- LOCK の陳腐化が 60000 ミリ秒、tools/list の ttlMs が 86400000、cacheScope が private であること
- session ハンドルが rl_ 前置の ULID、chain ハンドルが ch_ 前置の ULID であること
- audit の既定が include_artifacts:false / include_rejected:true / include_diffs:true / scope:"session" であること
- artifact_kind の既定が design→markdown / plan→plan / implement→fileset であること
- src 配下で defaults.js 以外に既定値の数値リテラル（9, 12, 8, 16, 28, 60000, 86400000, 1000000, 2097152, 5000）が現れないこと

**検証コマンド**:

- `grep -rn --include=*.js -e '86400000' -e '2097152' -e '1000000' rubric-loop/server/src` → 終了コード 1（既定値の散在が0件であること（defaults.js を除く判定はテスト側で行う））
- `node --test rubric-loop/server/test/defaults.test.js` → 終了コード 0
- `node -e "const d=require('./rubric-loop/server/src/config/defaults.js');const a=[d.PASS_SCORE===9,d.PASS_WEIGHTED_MEAN===9.0,d.MAX_SCORE_JUMP===3,d.LOCK_STALE_MS===60000,d.ARTIFACT_MAX_BYTES===1000000,d.PLAN_MAX_TASKS===200,d.CHAIN_MAX_ROUNDS===28];process.exit(a.every(Boolean)?0:1)"` → 終了コード 0（主要既定値の機械確認）

**見積**: 2 周

## フェーズ1: 7ツール・連鎖・監査・スキル（T021–T049）

7本のツールを1本ずつ立ち上げ、その上に連鎖・失効・差し戻し・監査・スキルを積む。T038 まででdesign モードが単体で完結し、T047 で3モードと監査が完結する。

### T021 loop_open の mode:"create" を実装する

**狙い**: サーバ発行の rl_ 前置 ULID をセッションハンドルとして払い出し、task / rubric / policy / loop_mode を固定して DRAFTING に入る。クライアントが session_id を自称する経路を E_HANDLE_NOT_ACCEPTED で塞ぐ（MCP 2026-07-28 のハンドル規定）。人間向けの想起は label に分離する。

**設計書参照**: `6.4.1 `loop_open`` / `18.1 改訂の要点と本設計の対応` / `19. 3モード拡張（design → plan → implement）` / `19.1 モードの定義`

**依存**: T014, T018, T019, T020

**変更**:

- `rubric-loop/server/src/tools/loop_open_create.js` (add)  — ULID 生成・rubric 確定・DRAFTING 遷移
- `rubric-loop/server/src/id/ulid.js` (add)  — rl_ / ch_ 前置の ULID 生成
- `rubric-loop/server/test/loop_open_create.test.js` (add)  — ハンドル自称拒否と既定 rubric 選択を検査

**受け入れ条件**:

- mode:"create" の成功応答が rl_ 前置の26文字 ULID を session_id として返すこと
- mode:"create" で session_id を指定すると E_HANDLE_NOT_ACCEPTED になること
- rubric 未指定のとき loop_mode に対応する presets が採用されること
- loop_mode 未指定のとき "design" が採用されること
- 作成直後の state が DRAFTING、round が 1 であること
- EPHEMERAL かつ allow_ephemeral 未指定のとき E_NO_PERSISTENCE になること

**検証コマンド**:

- `node --test rubric-loop/server/test/loop_open_create.test.js` → 終了コード 0

**見積**: 3 周

### T022 loop_open の mode:"resume" とハンドル1個からの完全再開を実装する

**狙い**: session_id または label でセッションを再開し、rubric 全文・履歴・must_fix・上流・チェーンを復元する。存在しなければ E_SESSION_NOT_FOUND、label が複数一致すれば候補を添えて E_AMBIGUOUS_LABEL、resume で rubric を渡したら E_RUBRIC_ON_RESUME で拒否する。再開がモデルの記憶に依存しないことをここで担保する。

**設計書参照**: `6.4.1 `loop_open`` / `8.5 再開が「モデルの記憶に依存しない」ことの担保` / `19.11 永続と再開` / `19.11.2 ハンドル1個からの完全再開` / `19.11.3 途中モードからの再開で新しいセッションを作りたい場合`

**依存**: T021

**変更**:

- `rubric-loop/server/src/tools/loop_open_resume.js` (add)  — session_id / label 解決と復元
- `rubric-loop/server/test/loop_open_resume.test.js` (add)  — 3エラーと完全復元を検査

**受け入れ条件**:

- 存在しない session_id の resume が E_SESSION_NOT_FOUND になること
- 同じ label のセッションが2件あるとき E_AMBIGUOUS_LABEL になり detail.candidates に両方の session_id が入ること
- mode:"resume" で rubric を渡すと E_RUBRIC_ON_RESUME になること
- 再開応答だけで rubric 全文・現在 round・state・直前の must_fix・上流ピン・chain_id が揃うこと
- サーバプロセスを再起動しても同じハンドルで同じ状態が復元されること

**検証コマンド**:

- `node --test rubric-loop/server/test/loop_open_resume.test.js` → 終了コード 0

**見積**: 2 周

### T023 チェーンと上流ピン（chain.json / upstream）を実装する

**狙い**: ch_ 前置 ULID の chain_id と chains/<chain_id>/chain.json の追記のみの台帳を実装し、loop_open が plan / implement で upstream:{session_id, artifact_digest} を必須にする。上流の版を知らずに下流を始める失敗（F15）を塞ぐ。

**設計書参照**: `19.2 連鎖の機構（上流ピン）` / `19.2.1 チェーンとピン` / `19.6.3 `loop_open` の差分` / `19.11.1 ディレクトリ構成（改訂後・実物）`

**依存**: T022

**変更**:

- `rubric-loop/server/src/chain/store.js` (add)  — chain.json の追記のみ台帳
- `rubric-loop/server/src/chain/pin.js` (add)  — upstream ピンの検証
- `rubric-loop/server/test/chain_pin.test.js` (add)  — 上流5エラーと台帳追記を検査

**受け入れ条件**:

- loop_mode:"plan" で upstream 未指定のとき E_UPSTREAM_REQUIRED になること
- loop_mode:"design" で upstream を指定すると E_UPSTREAM_NOT_ALLOWED になること
- 存在しない上流 session_id は E_UPSTREAM_NOT_FOUND になること
- 上流が FINAL でも FINAL_WITH_RELAXATION でもないとき E_UPSTREAM_NOT_FINAL になること
- 上流の loop_mode が直前段でないとき E_UPSTREAM_MODE_MISMATCH になること
- artifact_digest が上流の確定成果物と不一致のとき E_UPSTREAM_DIGEST_MISMATCH になること
- chain.json が追記のみで、既存レコードが書き換わらないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/chain_pin.test.js` → 終了コード 0

**見積**: 3 周

### T024 チェーン予算 chain_max_rounds / chain_max_kickbacks を実装する

**狙い**: チェーン合計 28 周と差し戻し上限 2 回を上位予算として持ち、超過を E_CHAIN_BUDGET_EXHAUSTED で止める。上乗せは人間承認で1回だけ（chain_extra_rounds 6）。3モード合計での暴走（F20）を塞ぐ。

**設計書参照**: `19.10.2 チェーン予算` / `19.10 収束・打ち切り・チェーン予算` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T023

**変更**:

- `rubric-loop/server/src/chain/budget.js` (add)  — 合計周回と kickback 回数の集計と判定
- `rubric-loop/server/test/chain_budget.test.js` (add)  — 28 周超過と kickback 3 回目を検査

**受け入れ条件**:

- チェーン合計 round が 28 に達した状態での loop_open が E_CHAIN_BUDGET_EXHAUSTED になること
- チェーン合計 round が 28 に達した状態での score_submit が E_CHAIN_BUDGET_EXHAUSTED になること
- 3 回目の escalate(action:"kickback") が E_CHAIN_BUDGET_EXHAUSTED になること
- 人間承認による chain_extra_rounds 6 の上乗せが同一チェーンで1回しか効かないこと
- 予算判定の入力が chain.json の集計値のみで、セッション単体の値に依存しないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/chain_budget.test.js` → 終了コード 0

**見積**: 2 周

### T025 loop_state を実装する

**狙い**: 全状態で呼べる唯一の復帰口として、状態・rubric 全文・履歴・must_fix・上流・チェーンを返す。ITERATING 応答では最低点3基準の全文アンカーを必ず同梱し、文脈圧縮で rubric が消える失敗（F3）と周回中にループを忘れる失敗（F2）を塞ぐ。存在しないセッションは E_SESSION_NOT_FOUND。

**設計書参照**: `6.4.2 `loop_state`` / `3. アーキテクチャ` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T014, T023

**変更**:

- `rubric-loop/server/src/tools/loop_state.js` (add)  — 読み取り専用。全状態で許可
- `rubric-loop/server/test/loop_state.test.js` (add)  — 全状態で呼べること・アンカー同梱を検査

**受け入れ条件**:

- 設計書 3 の責務分割どおり、loop_state が文章の良し悪しを一切判断せず、状態・rubric・履歴・must_fix の再供給だけを行うこと（応答に評価文言を生成するコードパスが無い）
- 9状態すべてで loop_state が成功すること
- 応答に rubric の全文（criteria の anchors を含む）が入ること
- 直前が ITERATING のとき最低点3基準の全文アンカーが応答に含まれること
- 応答に upstream ピンと chain_id と chain の周回集計が含まれること
- 存在しない session_id で E_SESSION_NOT_FOUND になること
- include に未知の値を渡すなど入力スキーマに違反したとき E_VALIDATION になること（19.6.7 の総覧どおり loop_state が返しうるのは E_VALIDATION と E_SESSION_NOT_FOUND の2件のみ）
- 上流を持たない design セッションに include:["upstream"] を渡してもエラーにせず、upstream_artifact を省いて warnings に no_upstream を返すこと
- loop_state が状態を一切変更しないこと（呼び出し前後で session.json のダイジェストが不変）

**検証コマンド**:

- `node --test rubric-loop/server/test/loop_state.test.js` → 終了コード 0

**見積**: 2 周

### T026 artifact_commit の本体（content 系）と addresses を実装する

**狙い**: markdown / text の成果物を内容アドレスで artifacts/ に保存し digest を確定して SCORING に遷移する。round>=2 では addresses が前周 must_fix[0].criterion_id を含むことを必須化し、最低点を動かさない周（H2 由来）を E_ADDRESS_MISSING で弾く。

**設計書参照**: `6.4.3 `artifact_commit`` / `19.5.1 判断: 単一文字列 `content` では足りない` / `8.1 ディレクトリ構成`

**依存**: T014, T018, T006

**変更**:

- `rubric-loop/server/src/tools/artifact_commit.js` (add)  — 保存・digest 確定・SCORING 遷移
- `rubric-loop/server/src/artifact/store.js` (add)  — artifacts/sha256-<hex>.<ext> と artifacts/index.json
- `rubric-loop/server/test/artifact_commit.test.js` (add)  — digest 確定・addresses・サイズ上限を検査

**受け入れ条件**:

- commit 後に state が SCORING になり、応答が artifact_digest を返すこと
- 同一内容を2回 commit しても artifacts/ に1ファイルしか増えないこと
- artifacts/index.json に round -> digest の対応が記録されること
- round>=2 で addresses が前周 must_fix[0].criterion_id を含まないとき E_ADDRESS_MISSING になること
- content が 1000001 バイトのとき E_VALIDATION になり、1000000 バイトは通ること
- SCORING 状態での artifact_commit が E_STATE_VIOLATION になること
- 同一 submission_id の再送で artifacts/ が増えないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/artifact_commit.test.js` → 終了コード 0

**見積**: 3 周

### T027 artifact_kind のモード別ディスパッチと E_ARTIFACT_KIND_MISMATCH を実装する

**狙い**: loop_mode に対して既定の artifact_kind（design→markdown / plan→plan / implement→fileset）を割り当て、モードと kind の不整合を E_ARTIFACT_KIND_MISMATCH で拒否する。成果物の型を単一文字列 content で済ませない判断をここで実装に落とす。

**設計書参照**: `19.5 成果物の型` / `19.6.4 `artifact_commit` の差分` / `19.5.1 判断: 単一文字列 `content` では足りない`

**依存**: T026

**変更**:

- `rubric-loop/server/src/artifact/kind.js` (add)  — モード×kind の許可表と既定値
- `rubric-loop/server/test/artifact_kind.test.js` (add)  — 既定値と不整合拒否を検査

**受け入れ条件**:

- loop_mode:"design" の既定 artifact_kind が markdown であること
- loop_mode:"plan" の既定 artifact_kind が plan であること
- loop_mode:"implement" の既定 artifact_kind が fileset であること
- loop_mode:"plan" で artifact_kind:"fileset" を渡すと E_ARTIFACT_KIND_MISMATCH になること
- loop_mode:"design" で artifact_kind:"plan" を渡すと E_ARTIFACT_KIND_MISMATCH になること

**検証コマンド**:

- `node --test rubric-loop/server/test/artifact_kind.test.js` → 終了コード 0

**見積**: 1 周

### T028 artifact_kind:"plan" のスキーマ検査（E_PLAN_SCHEMA）を実装する

**狙い**: 19.5.2 の JSON Schema を実物として持ち、plan 成果物を検証する。plan_version / summary / tasks の必須、task の design_refs を含む8キーの必須、id の ^T[0-9]{3}$、tasks の 1 から 200 件、additionalProperties:false 違反をすべて E_PLAN_SCHEMA で弾く。design_refs の欠落と空配列はここで止まり、T030 の実在照合までは到達しない。

**設計書参照**: `19.5.2 `artifact_kind: "plan"` — 計画の型`

**依存**: T027, T012

**変更**:

- `rubric-loop/server/schemas/plan.json` (add)  — 19.5.2 の JSON Schema 実物
- `rubric-loop/server/src/artifact/plan_schema.js` (add)  — plan.json による検証。違反は E_PLAN_SCHEMA
- `rubric-loop/server/test/plan_schema.test.js` (add)  — 必須欠落・pattern・minItems・additionalProperties を検査

**受け入れ条件**:

- plan_version / summary / tasks のいずれかを欠くと E_PLAN_SCHEMA になること
- task の id が T1 や TASK001 のとき pattern 違反として E_PLAN_SCHEMA になること
- tasks が 0 件のとき、および 201 件のとき E_PLAN_SCHEMA になること
- task に未知キーを足すと additionalProperties 違反で E_PLAN_SCHEMA になること
- summary が 39 文字のとき E_PLAN_SCHEMA、40 文字は通ること
- changes / acceptance / verify のいずれかが 0 件のとき E_PLAN_SCHEMA になること
- task が design_refs を持たないとき required 違反として E_PLAN_SCHEMA になり detail.path が /tasks/<i>/design_refs、detail.reason が required になること
- design_refs が空配列のとき minItems 違反として E_PLAN_SCHEMA になり detail.reason が min_items になること
- task スキーマの required が id / title / intent / design_refs / depends_on / changes / acceptance / verify の8件であること

**検証コマンド**:

- `jq -e '.required==["plan_version","summary","tasks"] and .additionalProperties==false' rubric-loop/server/schemas/plan.json` → 終了コード 0
- `jq -e '.properties.tasks.items.required==["id","title","intent","design_refs","depends_on","changes","acceptance","verify"]' rubric-loop/server/schemas/plan.json` → 終了コード 0（design_refs が required に入っていることの実物確認）
- `node --test rubric-loop/server/test/plan_schema.test.js` → 終了コード 0

**見積**: 3 周

### T029 plan の機械検査（E_PLAN_INVALID）を実装する

**狙い**: スキーマを通った plan に対し、id 重複なし・depends_on の参照先実在・循環なし（トポロジカルソート）・孤立タスクなし・各タスクに acceptance と verify が1件以上、を検査してすべて E_PLAN_INVALID で弾く。

**設計書参照**: `19.5.2 `artifact_kind: "plan"` — 計画の型`

**依存**: T028

**変更**:

- `rubric-loop/server/src/artifact/plan_checks.js` (add)  — 重複・幽霊依存・循環・孤立・空欄の5検査
- `rubric-loop/server/test/plan_checks.test.js` (add)  — 5検査それぞれの失敗例と成功例

**受け入れ条件**:

- id が重複する plan が E_PLAN_INVALID になり detail に重複 id が入ること
- depends_on が存在しない id を指す plan が E_PLAN_INVALID になること
- T001->T002->T001 の循環を持つ plan が E_PLAN_INVALID になり detail に残余 id が入ること
- 2件以上のタスクがあり、どこからも参照されずどこも参照しない孤立タスクがある plan が E_PLAN_INVALID になること
- 循環が無い plan についてトポロジカル順序が1本返ること

**検証コマンド**:

- `node --test rubric-loop/server/test/plan_checks.test.js` → 終了コード 0

**見積**: 3 周

### T030 design_refs の実在照合（E_PLAN_DESIGN_REF）を実装する

**狙い**: plan の全タスクの design_refs 各要素が、ピンした上流設計書本文に正規化後の部分一致で実在することを照合し、1件でも外れたら E_PLAN_DESIGN_REF を detail.task_id と detail.ref 付きで返す。計画に設計外の作業を混ぜる失敗（F18）を塞ぐ。

**設計書参照**: `19.5.2 `artifact_kind: "plan"` — 計画の型` / `19.2.2 上流本文の供給` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T029, T023

**変更**:

- `rubric-loop/server/src/artifact/design_refs.js` (add)  — 正規化後の部分一致照合
- `rubric-loop/server/test/design_refs.test.js` (add)  — 実在・不在・正規化差異を検査

**受け入れ条件**:

- 上流本文に実在する見出し文字列を design_refs に持つ plan が通ること
- 上流本文に存在しない文字列を1件でも持つと E_PLAN_DESIGN_REF になること
- エラーの detail に task_id と ref が両方入ること
- CRLF・行末空白・NFD の差異があっても正規化後に一致すれば通ること
- 照合対象がピンした上流の artifact_digest に対応する本文であり、現在の上流最新版ではないこと
- design_refs の欠落・空配列は T028 のスキーマ検査で E_PLAN_SCHEMA になり、この照合器には到達しないこと（欠落はスキーマ違反、実在しない参照は E_PLAN_DESIGN_REF という役割分担）

**検証コマンド**:

- `node --test rubric-loop/server/test/design_refs.test.js` → 終了コード 0

**見積**: 3 周

### T031 artifact_kind:"fileset" のマニフェスト検査を実装する

**狙い**: {path, sha256, bytes, role} の manifest と manifest_command / manifest_output_sha256 を検証する。ファイル 5000 件・path 1024 バイト・manifest 2 MB の上限を守り、マニフェストを再現できないときは E_MANIFEST_UNVERIFIABLE を返す。

**設計書参照**: `19.5.3 `artifact_kind: "fileset"` — 実装の型` / `19.8.1 結合による検証`

**依存**: T027, T006

**変更**:

- `rubric-loop/server/schemas/fileset.json` (add)  — 19.5.3 のマニフェストスキーマ実物
- `rubric-loop/server/src/artifact/fileset.js` (add)  — manifest 検証と manifest_output_sha256 の再計算
- `rubric-loop/server/test/fileset.test.js` (add)  — 上限3種と再現不能を検査

**受け入れ条件**:

- manifest の各要素が path / sha256 / bytes / role の4キーを持つこと
- manifest_output_sha256 が manifest_command の出力の正規化ダイジェストと一致しないとき E_MANIFEST_UNVERIFIABLE になること
- manifest が 5001 件のとき E_VALIDATION、5000 件は通ること
- path が 1025 バイトのとき E_VALIDATION、1024 バイトは通ること
- manifest が 2097153 バイトのとき E_VALIDATION、2097152 バイトは通ること

**検証コマンド**:

- `node --test rubric-loop/server/test/fileset.test.js` → 終了コード 0

**見積**: 3 周

### T032 test_inventory の台帳と削除・skip 増加の検出を実装する

**狙い**: implement モードで test_inventory/<round>.json を必須化し、前周差分でテストの説明なき削除と skip 増加を検出する。台帳が無ければ E_TEST_INVENTORY_REQUIRED、回帰は E_TEST_REGRESSION。テストを消して green にする失敗（F19）の前半を塞ぐ。

**設計書参照**: `19.8.2 テストを消す／スキップする` / `19.8 実装モードのごまかし対策`

**依存**: T031

**変更**:

- `rubric-loop/server/src/implement/test_inventory.js` (add)  — 台帳の保存と前周差分
- `rubric-loop/server/test/test_inventory.test.js` (add)  — 欠落・削除・skip 増を検査

**受け入れ条件**:

- implement モードの artifact_commit で test_inventory 未添付なら E_TEST_INVENTORY_REQUIRED になること
- 前周に存在したテスト名が説明なく消えたとき E_TEST_REGRESSION になり detail に消えたテスト名が入ること
- skip 数が前周より増えたとき E_TEST_REGRESSION になること
- 削除の説明が添えられた場合は通り、監査に削除理由が残ること
- test_inventory がテストの失敗を報告している状態で pass_score 以上のスコアを出すと E_TEST_NOT_GREEN になること
- design / plan モードでは test_inventory を要求しないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/test_inventory.test.js` → 終了コード 0

**見積**: 3 周

### T033 アサート弱化の検出（E_TEST_MUTATED_WITHOUT_DIFF）を実装する

**狙い**: 変更されたテストファイルには差分の添付を必須化し、添付が無ければ E_TEST_MUTATED_WITHOUT_DIFF で拒否する。toBe を toBeDefined に緩めるようなアサート弱化（F19 の後半）を差分の強制提示で監査可能にする。

**設計書参照**: `19.8.3 アサートを弱める` / `19.8.4 守れない範囲（正直な線引き）`

**依存**: T032

**変更**:

- `rubric-loop/server/src/implement/assert_mutation.js` (add)  — テストファイルの sha256 変化検出と差分必須化
- `rubric-loop/server/test/assert_mutation.test.js` (add)  — 差分なし変更の拒否と添付時の受理を検査

**受け入れ条件**:

- 前周と sha256 が異なるテストファイルがあり差分が添付されていないとき E_TEST_MUTATED_WITHOUT_DIFF になること
- 差分が添付されていれば受理され、差分が監査 JSON に残ること
- テストファイル以外の変更は差分添付を要求しないこと
- 設計書 19.8.4 が挙げる検出不能な手口（実装側を書き換えてテストに合わせる等）について、応答の warnings に honest_limits として該当項目名が列挙されること

**検証コマンド**:

- `node --test rubric-loop/server/test/assert_mutation.test.js` → 終了コード 0

**見積**: 2 周

### T034 根拠モデル（evidence）と5つ組コマンド根拠を実装する

**狙い**: evidence の kind として command / locator / upstream を実装し、evidence_digest を sha256(kind + locator/command + excerpt) で確定する。command 根拠は {command, exit_code, output_excerpt, target_path, target_digest} の5つ組を必須にして結合検証を成立させる。根拠なしの自己採点（F1）と存在しない引用（F11）をここで塞ぐ。

**設計書参照**: `6.4.4 `score_submit`` / `19.2.3 上流を参照する根拠 `kind:"upstream"`` / `19.8.1 結合による検証`

**依存**: T026, T006

**変更**:

- `rubric-loop/server/src/evidence/model.js` (add)  — 3 kind の型と evidence_digest
- `rubric-loop/server/src/evidence/verify.js` (add)  — locator の本文照合と command 5つ組の検証
- `rubric-loop/server/test/evidence.test.js` (add)  — 3 kind と digest 安定性と 5つ組を検査

**受け入れ条件**:

- evidence が0件の基準があると E_EVIDENCE_REQUIRED になること
- verification:"auto" の基準に kind:"locator" を出すと E_EVIDENCE_KIND になること
- locator 根拠の excerpt が保存済み成果物本文に正規化後の部分一致で見つからないとき E_EVIDENCE_NOT_FOUND になること
- command 根拠の target_digest が現在の成果物 digest と一致しないとき E_EVIDENCE_TARGET になること
- kind:"upstream" の根拠がピンした上流本文に対して照合されること
- 同一の kind と command と excerpt から常に同じ evidence_digest が出ること

**検証コマンド**:

- `node --test rubric-loop/server/test/evidence.test.js` → 終了コード 0

**見積**: 3 周

### T035 score_submit の判定アルゴリズム（手順0から13）を実装する

**狙い**: 手順0の冪等判定から、digest 束縛・全基準充足・重み付き平均・改善量・停滞カウンタ・判定・永続化・round 進行までを 7.1 の順序どおりに実装する。判定を返す唯一のツールであり、FINAL はサーバだけが出す。早期 FINAL 宣言（F6）と、採点後に成果物だけ差し替える手口（F10）をここで塞ぐ。

**設計書参照**: `7.1 判定アルゴリズム（`score_submit` の中核）` / `7. 判定・収束・打ち切り` / `6.4.4 `score_submit``

**依存**: T034, T020, T018

**変更**:

- `rubric-loop/server/src/tools/score_submit.js` (add)  — 手順0から13の逐次実装
- `rubric-loop/server/src/judge/engine.js` (add)  — 閾値判定と verdict 決定
- `rubric-loop/server/test/score_submit.test.js` (add)  — 13手順の順序と判定分岐を検査

**受け入れ条件**:

- artifact_digest が引数に無い、またはサーバ保持値と不一致のとき E_DIGEST_MISMATCH になること
- 全基準を埋めていない提出が E_INCOMPLETE_SCORES になり detail に欠落 criterion_id が入ること
- score が 10 未満の基準に weakness が無いとき E_WEAKNESS_REQUIRED になること
- rationale が 39 文字のとき E_VALIDATION、40 文字は通ること
- min_score>=9 かつ weighted_mean>=9.0 のとき verdict が FINAL になること
- 閾値未満のとき verdict が ITERATING になり must_fix が最低点3基準を昇順で返すこと
- モデルの self_verdict_note が判定式に一切影響しないこと（同じ点数なら note を変えても verdict が同一）
- ITERATING のときだけ round が +1 されること
- 受理された提出が rounds/<round>.json に、拒否された提出が rounds/<round>.rejected/<n>.json に error_code 付きで残ること

**検証コマンド**:

- `node --test rubric-loop/server/test/score_submit.test.js` → 終了コード 0

**見積**: 3 周

### T036 スコアのインフレ・ジャンプ・根拠使い回しの検出を実装する

**狙い**: artifact_digest 不変で1点でも上昇した提出を E_SCORE_INFLATION、1周1基準あたり +3 超を E_SCORE_JUMP（超過は exit_code:0 の command 根拠2件以上で許可）、スコアが上昇した基準で前周と同一 evidence_digest を E_EVIDENCE_STALE で拒否する。F5 と F8 と F9 を塞ぐ。

**設計書参照**: `7.1 判定アルゴリズム（`score_submit` の中核）` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T035

**変更**:

- `rubric-loop/server/src/judge/anti_gaming.js` (add)  — inflation / jump / stale の3検査
- `rubric-loop/server/test/anti_gaming.test.js` (add)  — 3検査の境界値を検査

**受け入れ条件**:

- digest 不変で1基準だけ +1 した提出が E_SCORE_INFLATION になり detail に上がった criterion_id が列挙されること
- digest 不変でスコアが全部同じ、または下がった提出は受理されること
- 1周で +4 の上昇があり command 根拠が1件のとき E_SCORE_JUMP になること
- 1周で +4 の上昇でも exit_code:0 の command 根拠が2件あれば受理されること
- スコアが上昇した基準で前周と同一の evidence_digest を出すと E_EVIDENCE_STALE になること
- スコアが上昇していない基準では同一 evidence_digest の再提出が許されること

**検証コマンド**:

- `node --test rubric-loop/server/test/anti_gaming.test.js` → 終了コード 0

**見積**: 3 周

### T037 rubric 版をまたぐ比較規則と previous_score の解決を実装する

**狙い**: 既存基準はそのまま比較、stricter に変わった基準はインフレ検査の対象外にして warnings に stricter_anchor_score_up、追加された新基準は previous_score を null にして検査をスキップし停滞カウンタを 0 に、削除された基準は前周の weighted_mean を新基準集合で再計算して比較する。

**設計書参照**: `7.1.1 rubric 版をまたぐときの比較規則`

**依存**: T036, T017

**変更**:

- `rubric-loop/server/src/judge/cross_version.js` (add)  — 4パターンの previous_score 解決と再計算
- `rubric-loop/server/test/cross_version.test.js` (add)  — 4パターンを1件ずつ検査

**受け入れ条件**:

- アンカーが stricter に変わった基準で点が上がっても E_SCORE_INFLATION にならず warnings に stricter_anchor_score_up が出ること
- 追加された新基準の previous_score が null になり、インフレ・ジャンプ・新規性検査がスキップされること
- 基準を追加した周では停滞カウンタが 0 にリセットされること
- 基準を削除したとき、比較対象の weighted_mean が新しい基準集合で再計算されること
- 低い点の基準を削除しても improvement が生まれないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/cross_version.test.js` → 終了コード 0

**見積**: 2 周

### T038 停滞検知と max_rounds 打ち切りを実装する

**狙い**: 加重平均の改善が stall_epsilon 未満の周を数え、stall_window 連続で STALLED、round が max_rounds に達しても STALLED にする。verdict_reason は no_improvement と max_rounds_reached で区別する。無限ループ（F7）を2系統で塞ぐ。

**設計書参照**: `7.3 打ち切りとエスカレーションの出口` / `7.2 既定値と根拠` / `19.10.1 モード別の値と理由`

**依存**: T035

**変更**:

- `rubric-loop/server/src/judge/stall.js` (add)  — 改善量の集計と2系統の打ち切り判定
- `rubric-loop/server/test/stall.test.js` (add)  — epsilon 境界と window と max_rounds を検査

**受け入れ条件**:

- 改善量が 0.24 の周は停滞としてカウントされ、0.25 の周はカウントされないこと
- design モードで停滞が3周連続したとき verdict が STALLED、verdict_reason が no_improvement になること
- plan モードでは停滞2周連続で STALLED になること
- round が max_rounds に達したとき verdict が STALLED、verdict_reason が max_rounds_reached になること
- STALLED では artifact_commit と score_submit と rubric_amend が E_STATE_VIOLATION で拒否され escalate だけが通ること

**検証コマンド**:

- `node --test rubric-loop/server/test/stall.test.js` → 終了コード 0

**見積**: 2 周

### T039 rubric_amend ツールと E_RELAXATION_UNACKNOWLEDGED を実装する

**狙い**: DRAFTING でのみ rubric を新版として受理し、緩和分類を rubric_diff に記録する。緩和を含む変更を acknowledge_relaxation なしで出すと E_RELAXATION_UNACKNOWLEDGED、閾値変更は E_THRESHOLD_IMMUTABLE で拒否する。

**設計書参照**: `6.4.5 `rubric_amend`` / `19.6.5 `score_submit` / `rubric_amend` / `escalate` / `audit_export` の差分`

**依存**: T017, T014, T018

**変更**:

- `rubric-loop/server/src/tools/rubric_amend.js` (add)  — DRAFTING 限定・新版保存・緩和記録
- `rubric-loop/server/test/rubric_amend.test.js` (add)  — 5エラーと版番号の進行を検査

**受け入れ条件**:

- SCORING で rubric_amend を呼ぶと E_STATE_VIOLATION になること
- 緩和を含む変更を acknowledge_relaxation なしで出すと E_RELAXATION_UNACKNOWLEDGED になること
- pass_score の変更が E_THRESHOLD_IMMUTABLE になること
- change_note が 19 文字のとき E_VALIDATION、20 文字は通ること
- 受理されると rubric/<n+1>.json と rubric_diff/<n+1>.json の両方が作られること
- expected_round 不一致のとき E_CONCURRENT になること

**検証コマンド**:

- `node --test rubric-loop/server/test/rubric_amend.test.js` → 終了コード 0

**見積**: 2 周

### T040 escalate の request_human / resolve / abort を実装する

**狙い**: STALLED から request_human で ESCALATED に移り escalations/esc_NN.token を生成する。resolve は human_token 必須で continue / accept_as_is / approve_relaxation / abort の4分岐を持ち、トークンは1回で消費される。応答にトークン値を載せない。

**設計書参照**: `6.4.6 `escalate`` / `7.3 打ち切りとエスカレーションの出口` / `19.10.3 エスカレーションの出口（3モード版）`

**依存**: T038, T014, T018

**変更**:

- `rubric-loop/server/src/tools/escalate.js` (add)  — action ディスパッチと ESCALATED 遷移
- `rubric-loop/server/src/escalation/token.js` (add)  — token ファイルの生成・照合・消費
- `rubric-loop/server/test/escalate_core.test.js` (add)  — 4分岐とトークン消費を検査

**受け入れ条件**:

- STALLED で request_human を呼ぶと state が ESCALATED になり escalations/esc_01.token が作られること
- 応答本文に human_token の値が一切含まれないこと
- 誤った human_token で resolve すると E_TOKEN_INVALID になり state が ESCALATED のままであること
- 正しい human_token の resolve/continue で state が DRAFTING、実効 max_rounds が +3、停滞カウンタが 0 になること
- 同じ human_token を再利用すると E_TOKEN_INVALID になること
- resolve/accept_as_is で state が FINAL_WITH_RELAXATION になり監査に赤旗が立つこと
- resolve/approve_relaxation の後、次の score_submit が閾値を満たせば FINAL_WITH_RELAXATION になること
- DRAFTING で resolution を渡すと E_RESOLUTION_NOT_APPLICABLE になること
- abort で state が ABORTED（終端）になること

**検証コマンド**:

- `node --test rubric-loop/server/test/escalate_core.test.js` → 終了コード 0

**見積**: 3 周

### T041 上流変更による失効（SUPERSEDED）の検出を実装する

**狙い**: 全ツール呼び出しの入口でピンした artifact_digest と上流の現在の確定 digest を比較し、不一致なら下流を SUPERSEDED に落とす。FINAL でも落とす。上流セッションが消えていた場合は E_UPSTREAM_NOT_FOUND。古い合格が残る失敗（F16）を塞ぐ。

**設計書参照**: `19.3 上流変更による下流の失効` / `19.3.1 上流はどうやって変わるのか` / `19.3.2 失効の検出` / `19.3.5 上流セッションが消えていた場合`

**依存**: T023, T014

**変更**:

- `rubric-loop/server/src/chain/supersede.js` (add)  — 入口フックでのピン比較と SUPERSEDED 遷移
- `rubric-loop/server/test/supersede.test.js` (add)  — FINAL からの失効と消失上流を検査

**受け入れ条件**:

- 上流の確定 digest が変わった後の任意のツール呼び出しで state が SUPERSEDED になること
- state が FINAL であっても SUPERSEDED に落ちること
- SUPERSEDED で artifact_commit を呼ぶと E_SUPERSEDED になること
- SUPERSEDED では escalate の rebase と abort、loop_state、audit_export だけが通ること
- 上流セッションのディレクトリが消えているとき E_UPSTREAM_NOT_FOUND になること
- 比較が全ツールの入口で行われ、ツールごとの実装に散らばっていないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/supersede.test.js` → 終了コード 0

**見積**: 3 周

### T042 escalate(action:"rebase") と部分再検証を実装する

**狙い**: SUPERSEDED から新しい上流 digest にピンし直し、carry_over と invalidated を計算して rebases/<n>.json に残す。carry_over した基準のスコアだけを引き継ぎ、invalidated は再採点対象にする。ピン先が存在しなければ E_UPSTREAM_NOT_FOUND、digest 不一致なら E_UPSTREAM_DIGEST_MISMATCH。

**設計書参照**: `19.3.3 部分再検証で済ませる条件` / `19.3.4 失効から復帰するまでの手順（下流視点）` / `19.4 差し戻し（下流 → 上流）`

**依存**: T041, T040

**変更**:

- `rubric-loop/server/src/chain/rebase.js` (add)  — carry_over / invalidated の計算と rebases/<n>.json
- `rubric-loop/server/test/rebase.test.js` (add)  — 部分再検証の分類と2エラーを検査

**受け入れ条件**:

- rebase 後に state が DRAFTING になり、upstream ピンが新しい digest に更新されること
- 上流の変更が触れていない節にだけ依存する基準が carry_over に分類されること
- 変更された節に依存する基準が invalidated に分類され、再採点が必須になること
- rebases/<n>.json に carry_over と invalidated の両方の criterion_id が残ること
- 存在しない上流を指す rebase が E_UPSTREAM_NOT_FOUND になること
- 指定 digest が上流の確定成果物と不一致のとき E_UPSTREAM_DIGEST_MISMATCH になること

**検証コマンド**:

- `node --test rubric-loop/server/test/rebase.test.js` → 終了コード 0

**見積**: 3 周

### T043 escalate(action:"kickback") と FROZEN を実装する

**狙い**: 下流から上流を再オープンし、下流を FROZEN にする。FROZEN では abort 以外の mutation が E_FROZEN で拒否され、下流だけ先に進む経路が存在しない。上流の欠陥を下流で辻褄合わせする失敗（F17）を塞ぐ。

**設計書参照**: `19.4 差し戻し（下流 → 上流）` / `19.9.2 状態ごとに呼べるツール（改訂後・全状態）`

**依存**: T042, T024

**変更**:

- `rubric-loop/server/src/chain/kickback.js` (add)  — 上流再オープンと下流の FROZEN 遷移
- `rubric-loop/server/test/kickback.test.js` (add)  — FROZEN の拒否範囲と kickback 回数を検査

**受け入れ条件**:

- kickback 後に下流の state が FROZEN、上流の state が DRAFTING になること
- FROZEN で artifact_commit / score_submit / rubric_amend を呼ぶと E_FROZEN になること
- FROZEN で escalate の abort だけが通り、他の action が E_STATE_VIOLATION になること
- kickback が chain.json に記録され、chain_max_kickbacks の集計に入ること
- 上流が再び FINAL になると下流が FROZEN から SUPERSEDED を経由して rebase 可能になること

**検証コマンド**:

- `node --test rubric-loop/server/test/kickback.test.js` → 終了コード 0

**見積**: 3 周

### T044 MRTR による人間承認を実装する

**狙い**: サーバ発の要求が廃止された前提で、MRTR（Multi Round-Trip Requests）を使って escalate の人間承認をクライアント往復として表現する。往復が成立しないホストでは token ファイル方式に縮退する。

**設計書参照**: `18.3 MRTR による人間承認（`escalate` の強化）` / `18.4 適合上の限界（正直に）`

**依存**: T040

**変更**:

- `rubric-loop/server/src/mcp/mrtr.js` (add)  — MRTR の往復とタイムアウト、token 方式へのフォールバック
- `rubric-loop/server/test/mrtr.test.js` (add)  — 往復成立時と非対応ホスト時の2経路を検査

**受け入れ条件**:

- MRTR に対応するホストでは escalate の承認が往復1回で完了すること
- MRTR 非対応のホストでは token ファイル方式に自動で縮退し warnings に mrtr_unavailable が出ること
- どちらの経路でも human_token の値が応答本文に載らないこと
- サーバ発のリクエスト（server-initiated request）を1箇所も使っていないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/mrtr.test.js` → 終了コード 0

**見積**: 2 周

### T045 audit_export のセッション単位出力を実装する

**狙い**: 監査 JSON version 1 を exports/audit-<timestamp>.json に書き出す。既定は include_artifacts:false / include_rejected:true / include_diffs:true / scope:"session"。第三者が同じ入力から同じ判定を再現できる情報を欠かさない。

**設計書参照**: `12. 監査可能性` / `12.1 監査 JSON のスキーマ（要点）` / `12.2 出力実例（1セッション分・抜粋なしの完全形）` / `6.4.7 `audit_export``

**依存**: T035, T039, T040

**変更**:

- `rubric-loop/server/src/tools/audit_export.js` (add)  — scope ディスパッチと exports/ への書き出し
- `rubric-loop/server/src/audit/session_v1.js` (add)  — 監査 JSON version 1 の生成
- `rubric-loop/server/test/audit_session.test.js` (add)  — 既定値・拒否提出の同梱・再現性を検査

**受け入れ条件**:

- 既定引数の audit_export が include_artifacts:false / include_rejected:true / include_diffs:true / scope:"session" で動くこと
- 出力 JSON の version が 1 であること
- 拒否された提出が error_code 付きで含まれること
- rubric の全版と rubric_diff が含まれること
- 全 evidence の evidence_digest と、各周の artifact_digest が含まれること
- 存在しない session_id で E_SESSION_NOT_FOUND になること
- exports/ 配下のファイル名が audit-<ISO8601 basic UTC>.json であること

**検証コマンド**:

- `node --test rubric-loop/server/test/audit_session.test.js` → 終了コード 0

**見積**: 3 周

### T046 audit_export のチェーン単位出力を実装する

**狙い**: scope:"chain" で監査 JSON version 2 を出し、design から implement までの3セッションのピン・rebase・kickback・予算消費を1本に貫く。chain_id を解決できないときは E_VALIDATION。

**設計書参照**: `19.13 監査可能性（連鎖を貫く）` / `19.13.1 `audit_export` の拡張` / `19.13.2 チェーン監査 JSON のスキーマ（構造）` / `19.13.3 連鎖1本分の実例（design → plan → implement）`

**依存**: T045, T043

**変更**:

- `rubric-loop/server/src/audit/chain_v2.js` (add)  — チェーン監査 JSON version 2 の生成
- `rubric-loop/server/test/audit_chain.test.js` (add)  — 3セッション連結と予算の集計を検査

**受け入れ条件**:

- scope:"chain" の出力 JSON の version が 2 であること
- チェーン内の全セッションが loop_mode の順（design, plan, implement）で並ぶこと
- 各下流セッションの upstream ピン（session_id と artifact_digest）が含まれること
- rebase と kickback の履歴が時刻付きで含まれること
- チェーン合計の周回数と chain_max_rounds に対する消費率が含まれること
- chain_id を解決できないとき E_VALIDATION になること

**検証コマンド**:

- `node --test rubric-loop/server/test/audit_chain.test.js` → 終了コード 0

**見積**: 2 周

### T047 第三者による再検証を成立させる検証スクリプトを同梱する

**狙い**: 監査 JSON だけを入力に、artifact_digest と evidence_digest と weighted_mean と verdict を再計算して一致を確かめる検証器を server/ に置く。監査が主張どおりであることを外部から確認できるようにする。

**設計書参照**: `12.3 第三者による再検証が成立する理由` / `19.13.4 第三者が再検証できること`

**依存**: T046, T006

**変更**:

- `rubric-loop/server/verify_audit.js` (add)  — 監査 JSON を入力に digest と判定を再計算する CLI
- `rubric-loop/server/test/verify_audit.test.js` (add)  — 正しい監査で 0、改竄した監査で 1 を返すことを検査

**受け入れ条件**:

- 正しい監査 JSON に対して verify_audit.js が終了コード 0 を返すこと
- スコアを1点だけ書き換えた監査 JSON に対して終了コード 1 を返し、不一致箇所を出力すること
- artifact 本文を含まない監査（include_artifacts:false）でも digest 整合は検証できること
- 再検証がサーバの内部状態に一切アクセスせず、監査 JSON のみを入力とすること

**検証コマンド**:

- `node --test rubric-loop/server/test/verify_audit.test.js` → 終了コード 0

**見積**: 2 周

### T048 SKILL.md（3モード対応版）を書く

**狙い**: PLAN / DO / VERIFY / DECIDE の型と、モードの選び方・手順・上流が変わったとき・上流が間違っていたとき・文脈を失ったときの各節を持つ単一スキルを置く。スキルは手順の記憶だけを担い、判定は一切しない。

**設計書参照**: `10. スキルとサーバの責務分割` / `10.1 線引き` / `10.2 `skills/rubric-loop/SKILL.md`（実物・3モード対応版）` / `19.12 スキル分割` / `19.12.1 判断: **1スキル**` / `19.12.2 `skills/rubric-loop/SKILL.md``

**依存**: T008

**変更**:

- `rubric-loop/skills/rubric-loop/SKILL.md` (add)  — 原則 / モードの選び方 / 手順 / 上流が変わったら / 上流が間違っていたら / 文脈を失ったとき / 縮退 の7節
- `rubric-loop/server/test/skill_md.test.js` (add)  — 7節の存在と禁止語を検査

**受け入れ条件**:

- SKILL.md に「原則」「モードの選び方」「手順」「上流が変わったと言われたら」「上流が間違っていると気づいたら」「文脈を失ったとき」「ツールが使えないとき（縮退）」の7見出しがすべて存在すること
- SKILL.md 中の FINAL の出現がすべて「サーバだけが出す語である」旨の記述であり、スキルが FINAL を宣言する手順が1件も無いこと
- 「文脈を失ったとき」節の手順が loop_state の呼び出し1回だけで構成され、他ツールの呼び出しを含まないこと
- スキルが1本だけであること（skills/ 配下のディレクトリが1つ）
- SKILL.md に資格情報および絶対パス（先頭が / または <drive>: の文字列）が1件も無いこと

**検証コマンド**:

- `grep -c '^原則$\|^モードの選び方$\|^手順$\|^上流が変わったと言われたら$\|^上流が間違っていると気づいたら$\|^文脈を失ったとき$\|^ツールが使えないとき（縮退）$' rubric-loop/skills/rubric-loop/SKILL.md` → 終了コード 0（7節の存在）
- `grep -n 'FINAL' rubric-loop/skills/rubric-loop/SKILL.md` → 終了コード 0（FINAL の出現行を全数列挙して文脈を目視できるようにする）
- `node --test rubric-loop/server/test/skill_md.test.js` → 終了コード 0

**見積**: 3 周

### T049 サーバ障害時の縮退規約（UNVERIFIED-COMPLETE）を SKILL.md に実装する

**狙い**: MCP が使えない周回では FINAL を名乗ることを禁じ、UNVERIFIED-COMPLETE に格下げしてフォールバック journal を残す規約を書く。3モードそれぞれで同じ縮退が効くことを明記する。サーバ不在での無検証完了宣言（F13）を塞ぐ。

**設計書参照**: `10.3 サーバ障害時の振る舞い（縮退の定義）` / `19.12.3 サーバ障害時の縮退（3モード）` / `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T048

**変更**:

- `rubric-loop/skills/rubric-loop/SKILL.md` (modify)  — 縮退節に UNVERIFIED-COMPLETE 規約と journal の書式を追加
- `rubric-loop/server/test/degraded.test.js` (add)  — 縮退規約の記述と journal 書式を検査

**受け入れ条件**:

- 縮退節に「FINAL を名乗らない」旨が明記されていること
- 縮退時の完了表現が UNVERIFIED-COMPLETE であることが明記されていること
- フォールバック journal の保存先と書式（1周1レコード、rubric 版・スコア・根拠を含む）が明記されていること
- design / plan / implement の3モードすべてで同じ縮退が適用されることが明記されていること
- サーバ復旧後に journal を artifact_commit と score_submit で追認する手順が書かれていること

**検証コマンド**:

- `grep -c 'UNVERIFIED-COMPLETE' rubric-loop/skills/rubric-loop/SKILL.md` → 終了コード 0（縮退語の存在）
- `node --test rubric-loop/server/test/degraded.test.js` → 終了コード 0

**見積**: 2 周

## フェーズ2: 受け入れテスト AT-1–AT-18（T050–T067）

設計書 13 の受け入れテストを1本1タスクで実装する。各タスクは単独で実行できる verify コマンドを持つ。

### T050 テスト: AT-1: 正常収束

**狙い**: 設計書 AT-1 の呼び出し列を上から実行し、期待どおり FINAL に到達することを確かめる。判定を出すのがサーバだけであることを正常系で固定する。

**設計書参照**: `13. 受け入れテスト` / `AT-1: 正常収束`

**依存**: T035, T045

**変更**:

- `rubric-loop/server/test/at/at01.test.js` (add)  — AT-1: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- loop_open から score_submit までの呼び出し列が設計書 AT-1 の記載順で実行できること
- 全基準 9 以上かつ加重平均 9.0 以上の提出で verdict が FINAL、verdict_reason が all_criteria_passed になること
- FINAL 到達後に artifact_commit を呼ぶと E_STATE_VIOLATION になること
- AT-1 単独で実行でき、他の AT テストの実行順に依存しないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at01.test.js` → 終了コード 0

**見積**: 2 周

### T051 テスト: AT-2: ごまかし検出①：成果物不変でスコアだけ上昇

**狙い**: 失敗モード F5 の受け入れテスト。artifact_digest を変えずにスコアだけ上げた提出が E_SCORE_INFLATION で拒否され、拒否記録が残ることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-2: ごまかし検出①：成果物不変でスコアだけ上昇`

**依存**: T036

**変更**:

- `rubric-loop/server/test/at/at02.test.js` (add)  — AT-2: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 同一 artifact_digest で1基準を +1 した score_submit が E_SCORE_INFLATION になること
- detail に上昇した criterion_id が列挙されること
- 拒否された提出が rounds/<round>.rejected/ に error_code 付きで残ること
- 拒否によって round が進まないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at02.test.js` → 終了コード 0

**見積**: 2 周

### T052 テスト: AT-3: ごまかし検出②：根拠の捏造と使い回し

**狙い**: 失敗モード F8 と F11 の受け入れテスト。成果物に存在しない引用と、前周と同一の evidence_digest の再利用がそれぞれ拒否されることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-3: ごまかし検出②：根拠の捏造と使い回し`

**依存**: T036, T034

**変更**:

- `rubric-loop/server/test/at/at03.test.js` (add)  — AT-3: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 成果物本文に存在しない excerpt を持つ locator 根拠が E_EVIDENCE_NOT_FOUND になること
- スコアが上昇した基準で前周と同一の evidence_digest を出すと E_EVIDENCE_STALE になること
- 両方の拒否が監査 JSON に error_code 付きで残ること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at03.test.js` → 終了コード 0

**見積**: 2 周

### T053 テスト: AT-4: 停滞打ち切り

**狙い**: 失敗モード F7 の受け入れテスト。改善量が stall_epsilon 未満の周が stall_window 連続したとき STALLED になり、escalate 以外の道が塞がることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-4: 停滞打ち切り`

**依存**: T038

**変更**:

- `rubric-loop/server/test/at/at04.test.js` (add)  — AT-4: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 改善量 0.25 未満の周が design モードで3周連続したとき verdict が STALLED になること
- verdict_reason が no_improvement であること
- STALLED で score_submit を呼ぶと E_STATE_VIOLATION になること
- STALLED で escalate だけが受理されること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at04.test.js` → 終了コード 0

**見積**: 2 周

### T054 テスト: AT-5: max_rounds 到達

**狙い**: 失敗モード F7 のもう一系統の受け入れテスト。round が max_rounds に達したとき、改善が続いていても STALLED になることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-5: max_rounds 到達`

**依存**: T038

**変更**:

- `rubric-loop/server/test/at/at05.test.js` (add)  — AT-5: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- round が design モードの max_rounds 12 に達したとき verdict が STALLED になること
- verdict_reason が max_rounds_reached であること
- 毎周改善している場合でも max_rounds では止まること
- 延長が escalate と human_token を経由しないと起きないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at05.test.js` → 終了コード 0

**見積**: 2 周

### T055 テスト: AT-6: セッション再開

**狙い**: 失敗モード F2 と F3 の受け入れテスト。サーバを再起動しハンドル1個だけで再開したとき、rubric 全文と履歴と must_fix が復元されることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-6: セッション再開`

**依存**: T022, T025

**変更**:

- `rubric-loop/server/test/at/at06.test.js` (add)  — AT-6: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- サーバプロセスを落として再起動した後、session_id だけで loop_open(resume) が成功すること
- 復元された rubric がアンカー本文まで一致すること
- 直前の must_fix が復元されること
- モデル側の記憶に相当する入力を一切与えずに再開が成立すること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at06.test.js` → 終了コード 0

**見積**: 2 周

### T056 テスト: AT-7: rubric の緩和を検出してエスカレーション

**狙い**: 失敗モード F4 の受け入れテスト。重みを下げる rubric_amend の後は FINAL に到達できず、ESCALATED(relaxation_pending_approval) になることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-7: rubric の緩和を検出してエスカレーション`

**依存**: T039, T040

**変更**:

- `rubric-loop/server/test/at/at07.test.js` (add)  — AT-7: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 重みを下げる rubric_amend が relaxation として rubric_diff に記録されること
- その後に全基準 9 以上を出しても verdict が ESCALATED、verdict_reason が relaxation_pending_approval になること
- resolve/approve_relaxation の後の提出で FINAL_WITH_RELAXATION になること
- FINAL には到達しないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at07.test.js` → 終了コード 0

**見積**: 2 周

### T057 テスト: AT-8: モデルの自己申告を無効化する

**狙い**: 失敗モード F1 と F6 の受け入れテスト。self_verdict_note に FINAL と書いても判定が変わらず、根拠なしのスコアが拒否されることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-8: モデルの自己申告を無効化する`

**依存**: T035, T034

**変更**:

- `rubric-loop/server/test/at/at08.test.js` (add)  — AT-8: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- self_verdict_note に "FINAL" を含めても閾値未満なら verdict が ITERATING になること
- self_verdict_note を変えただけで verdict と weighted_mean が一切変わらないこと
- evidence が0件の基準があると E_EVIDENCE_REQUIRED になること
- verification:"auto" の基準に command 以外の根拠を出すと E_EVIDENCE_KIND になること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at08.test.js` → 終了コード 0

**見積**: 2 周

### T058 テスト: AT-9: サーバ起動失敗時のスキル単独動作

**狙い**: 失敗モード F13 の受け入れテスト。MCP サーバが起動しない状況で、スキルが FINAL を名乗らず UNVERIFIED-COMPLETE に格下げして journal を残すことを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-9: サーバ起動失敗時のスキル単独動作`

**依存**: T049

**変更**:

- `rubric-loop/server/test/at/at09.test.js` (add)  — AT-9: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- サーバ不在時の縮退手順が SKILL.md に閉じており、ツール呼び出しを前提としないこと
- 縮退時の完了表現が UNVERIFIED-COMPLETE であり FINAL を名乗らないこと
- フォールバック journal に周ごとの rubric 版・スコア・根拠が残る書式であること
- 復旧後に journal を artifact_commit と score_submit で追認できること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at09.test.js` → 終了コード 0

**見積**: 2 周

### T059 テスト: AT-10: 3モード連鎖の正常系

**狙い**: design から plan、plan から implement へピンを張って連鎖が1本通ることを確かめる。各段の上流が FINAL であり digest が一致することが前提条件になる。

**設計書参照**: `13. 受け入れテスト` / `AT-10: 3モード連鎖の正常系`

**依存**: T023, T028, T031

**変更**:

- `rubric-loop/server/test/at/at10.test.js` (add)  — AT-10: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- design セッションが FINAL になった後、その artifact_digest をピンして plan セッションが開けること
- plan セッションが FINAL になった後、その digest をピンして implement セッションが開けること
- 3セッションが同一の chain_id を共有すること
- chain.json に3セッションが追記のみで並ぶこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at10.test.js` → 終了コード 0

**見積**: 3 周

### T060 テスト: AT-11: 上流の版を知らずに下流を開こうとする

**狙い**: 失敗モード F15 の受け入れテスト。upstream を省略した plan セッションの作成と、digest 不一致のピンがそれぞれ拒否されることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-11: 上流の版を知らずに下流を開こうとする`

**依存**: T023

**変更**:

- `rubric-loop/server/test/at/at11.test.js` (add)  — AT-11: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- loop_mode:"plan" で upstream を省略すると E_UPSTREAM_REQUIRED になること
- artifact_digest が上流の確定値と異なるとき E_UPSTREAM_DIGEST_MISMATCH になること
- 拒否された場合にセッションが1件も作られないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at11.test.js` → 終了コード 0

**見積**: 2 周

### T061 テスト: AT-12: 上流変更による下流の失効と部分再検証

**狙い**: 失敗モード F16 の受け入れテスト。上流が変わると下流が FINAL であっても SUPERSEDED に落ち、rebase で carry_over と invalidated に分かれることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-12: 上流変更による下流の失効と部分再検証`

**依存**: T041, T042

**変更**:

- `rubric-loop/server/test/at/at12.test.js` (add)  — AT-12: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 上流が新しい成果物で FINAL になった後、下流の任意のツール呼び出しで state が SUPERSEDED になること
- 下流が FINAL であっても SUPERSEDED に落ちること
- escalate(action:"rebase") 後に carry_over と invalidated が rebases/1.json に記録されること
- invalidated に分類された基準だけが再採点必須になること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at12.test.js` → 終了コード 0

**見積**: 3 周

### T062 テスト: AT-13: 差し戻し（implement → plan）

**狙い**: 失敗モード F17 の受け入れテスト。implement から plan へ kickback したとき、下流が FROZEN になり先へ進めないことを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-13: 差し戻し（implement → plan）`

**依存**: T043

**変更**:

- `rubric-loop/server/test/at/at13.test.js` (add)  — AT-13: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- escalate(action:"kickback") で下流が FROZEN、上流が DRAFTING になること
- FROZEN で artifact_commit を呼ぶと E_FROZEN になること
- kickback が chain.json に記録されること
- 下流だけを先に進める呼び出し列が存在しないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at13.test.js` → 終了コード 0

**見積**: 2 周

### T063 テスト: AT-14: 実装モードのごまかし検出（テスト削除）

**狙い**: 失敗モード F19 の受け入れテスト。前周にあったテストの説明なき削除と skip 増加が拒否されることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-14: 実装モードのごまかし検出（テスト削除）`

**依存**: T032

**変更**:

- `rubric-loop/server/test/at/at14.test.js` (add)  — AT-14: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 前周の test_inventory にあったテスト名が説明なく消えた提出が E_TEST_REGRESSION になること
- skip 数が増えた提出が E_TEST_REGRESSION になること
- test_inventory を添付しない implement モードの artifact_commit が E_TEST_INVENTORY_REQUIRED になること
- 削除理由を添えた場合は受理され監査に理由が残ること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at14.test.js` → 終了コード 0

**見積**: 2 周

### T064 テスト: AT-15: 実装モードのごまかし検出（結果の使い回しとアサート弱化）

**狙い**: 失敗モード F19 の後半の受け入れテスト。過去のテスト実行結果の使い回しと、差分を添えないテスト書き換えが拒否されることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-15: 実装モードのごまかし検出（結果の使い回しとアサート弱化）`

**依存**: T033, T034

**変更**:

- `rubric-loop/server/test/at/at15.test.js` (add)  — AT-15: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- command 根拠の target_digest が現在の成果物 digest と異なるとき E_EVIDENCE_TARGET になること
- テストファイルの sha256 が変わったのに差分が添付されていないとき E_TEST_MUTATED_WITHOUT_DIFF になること
- テストが green でない状態で 9 点を出すと E_TEST_NOT_GREEN になること
- 差分を添えた弱化は受理されるが監査に差分がそのまま残ること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at15.test.js` → 終了コード 0

**見積**: 2 周

### T065 テスト: AT-16: チェーン予算の超過

**狙い**: 失敗モード F20 の受け入れテスト。チェーン合計 28 周と kickback 2 回の上限で止まり、上乗せが人間承認1回に限られることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-16: チェーン予算の超過`

**依存**: T024

**変更**:

- `rubric-loop/server/test/at/at16.test.js` (add)  — AT-16: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- チェーン合計 round が 28 に達した後の loop_open と score_submit が E_CHAIN_BUDGET_EXHAUSTED になること
- 3回目の kickback が E_CHAIN_BUDGET_EXHAUSTED になること
- 人間承認による chain_extra_rounds 6 の上乗せが同一チェーンで2回目は効かないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at16.test.js` → 終了コード 0

**見積**: 2 周

### T066 テスト: AT-17: 途中モードからの再開（実装セッションのハンドル1個）

**狙い**: implement セッションのハンドル1個だけから、上流2段分のピンとチェーン状況まで復元できることを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-17: 途中モードからの再開（実装セッションのハンドル1個）`

**依存**: T022, T023, T025

**変更**:

- `rubric-loop/server/test/at/at17.test.js` (add)  — AT-17: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- implement の session_id 1個だけで loop_open(resume) が成功すること
- 応答から plan セッションと design セッションの session_id と artifact_digest が辿れること
- chain.json の集計（合計周回・kickback 回数）が応答に含まれること
- 上流本文を再供給しなくても design_refs の照合が継続できること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at17.test.js` → 終了コード 0

**見積**: 2 周

### T067 テスト: AT-18: MCP サーバ起動失敗（3モード）

**狙い**: 失敗モード F13 の3モード版の受け入れテスト。design / plan / implement のどのモードでもサーバ不在時に同じ縮退が効くことを確かめる。

**設計書参照**: `13. 受け入れテスト` / `AT-18: MCP サーバ起動失敗（3モード）`

**依存**: T049

**変更**:

- `rubric-loop/server/test/at/at18.test.js` (add)  — AT-18: の呼び出し列と期待返り値をそのまま実行する

**受け入れ条件**:

- 3モードいずれでもサーバ不在時に FINAL を名乗らないことが SKILL.md で規定されていること
- 3モードいずれでも UNVERIFIED-COMPLETE への格下げが規定されていること
- 3モードいずれでもフォールバック journal の書式が同一であること
- 復旧後の追認手順が3モードで同一であること

**検証コマンド**:

- `node --test rubric-loop/server/test/at/at18.test.js` → 終了コード 0

**見積**: 2 周

## フェーズ3: 全数被覆テスト（T068–T076）

ツール表面のエラー全数、失敗モード F1–F20、既定値表、可搬性の混入検査を、実装側の抜けを検出する網としてかぶせる。

### T068 テスト: loop_open のエラー13件を全数検査する

**狙い**: 19.6.7 の総覧が loop_open について挙げる13件のエラーを1件ずつ再現し、E_INTERNAL 以外に14件目が出ないことも確かめる。ツール表面のエラー全数をテスト側から固定する。

**設計書参照**: `19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）` / `6.4.1 `loop_open``

**依存**: T021, T022, T023, T024

**変更**:

- `rubric-loop/server/test/errors_loop_open.test.js` (add)  — 13件の再現ケース

**受け入れ条件**:

- E_VALIDATION, E_HANDLE_NOT_ACCEPTED, E_SESSION_NOT_FOUND, E_AMBIGUOUS_LABEL, E_NO_PERSISTENCE, E_RUBRIC_ON_RESUME の6件が再現されること
- E_UPSTREAM_REQUIRED, E_UPSTREAM_NOT_ALLOWED, E_UPSTREAM_NOT_FOUND, E_UPSTREAM_NOT_FINAL, E_UPSTREAM_MODE_MISMATCH, E_UPSTREAM_DIGEST_MISMATCH, E_CHAIN_BUDGET_EXHAUSTED の7件が再現されること
- テストが列挙するエラーコード集合が13件ちょうどであること
- 想定外の入力でも E_INTERNAL 以外の未知コードが出ないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/errors_loop_open.test.js` → 終了コード 0

**見積**: 3 周

### T069 テスト: artifact_commit のエラー13件を全数検査する

**狙い**: 19.6.7 の総覧が artifact_commit について挙げる13件のエラーを1件ずつ再現する。plan / fileset 固有の検査エラーも含めてツール表面を固定する。

**設計書参照**: `19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）` / `6.4.3 `artifact_commit``

**依存**: T026, T027, T030, T031, T032, T041, T043

**変更**:

- `rubric-loop/server/test/errors_artifact_commit.test.js` (add)  — 13件の再現ケース

**受け入れ条件**:

- E_STATE_VIOLATION, E_CONCURRENT, E_VALIDATION, E_ADDRESS_MISSING, E_ARTIFACT_KIND_MISMATCH, E_MANIFEST_UNVERIFIABLE, E_TEST_INVENTORY_REQUIRED の7件が再現されること
- E_TEST_MUTATED_WITHOUT_DIFF, E_PLAN_SCHEMA, E_PLAN_INVALID, E_PLAN_DESIGN_REF, E_FROZEN, E_SUPERSEDED の6件が再現されること
- テストが列挙するエラーコード集合が13件ちょうどであること
- 拒否時に成果物が artifacts/ に保存されないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/errors_artifact_commit.test.js` → 終了コード 0

**見積**: 3 周

### T070 テスト: score_submit のエラー18件を全数検査する

**狙い**: 19.6.7 の総覧が score_submit について挙げる18件のエラーを1件ずつ再現する。判定を返す唯一のツールなので、拒否条件の全数をテストで固定する。

**設計書参照**: `19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）` / `6.4.4 `score_submit``

**依存**: T035, T036, T037, T032, T033, T041, T043, T024

**変更**:

- `rubric-loop/server/test/errors_score_submit.test.js` (add)  — 18件の再現ケース

**受け入れ条件**:

- E_STATE_VIOLATION, E_CONCURRENT, E_DIGEST_MISMATCH, E_INCOMPLETE_SCORES, E_EVIDENCE_REQUIRED, E_EVIDENCE_KIND の6件が再現されること
- E_EVIDENCE_NOT_FOUND, E_EVIDENCE_STALE, E_EVIDENCE_TARGET, E_SCORE_INFLATION, E_SCORE_JUMP, E_WEAKNESS_REQUIRED の6件が再現されること
- E_TEST_REGRESSION, E_TEST_NOT_GREEN, E_UPSTREAM_NOT_ALLOWED, E_FROZEN, E_SUPERSEDED, E_CHAIN_BUDGET_EXHAUSTED の6件が再現されること
- テストが列挙するエラーコード集合が18件ちょうどであること
- 拒否時に round が進まないこと

**検証コマンド**:

- `node --test rubric-loop/server/test/errors_score_submit.test.js` → 終了コード 0

**見積**: 3 周

### T071 テスト: 残る4ツールのエラー15件を全数検査する

**狙い**: loop_state 1件、rubric_amend 5件、escalate 7件、audit_export 2件を1件ずつ再現し、7ツール分の総和が 19.6.7 の記載と一致することを確かめる。

**設計書参照**: `19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）` / `6.4.2 `loop_state`` / `6.4.5 `rubric_amend`` / `6.4.6 `escalate`` / `6.4.7 `audit_export``

**依存**: T025, T039, T040, T042, T045, T046

**変更**:

- `rubric-loop/server/test/errors_rest.test.js` (add)  — 15件の再現ケース

**受け入れ条件**:

- loop_state の E_SESSION_NOT_FOUND が再現され、状態違反が構造的に起きないことが確認されること
- rubric_amend の E_STATE_VIOLATION, E_CONCURRENT, E_THRESHOLD_IMMUTABLE, E_RELAXATION_UNACKNOWLEDGED, E_VALIDATION の5件が再現されること
- escalate の E_STATE_VIOLATION, E_TOKEN_INVALID, E_RESOLUTION_NOT_APPLICABLE, E_VALIDATION, E_UPSTREAM_NOT_FOUND, E_UPSTREAM_DIGEST_MISMATCH, E_CHAIN_BUDGET_EXHAUSTED の7件が再現されること
- audit_export の E_SESSION_NOT_FOUND と E_VALIDATION の2件が再現されること
- 7ツールで再現したコードの重複排除後の集合に E_INTERNAL を足すと 42 件になること

**検証コマンド**:

- `node --test rubric-loop/server/test/errors_rest.test.js` → 終了コード 0

**見積**: 3 周

### T072 テスト: 失敗モード F1 から F10 の対策が効くことを検査する

**狙い**: 設計書 2 の対応表の F1 から F10 について、塞ぐ機構が実際に効いていることを1件ずつ検査する。F1 自己採点の甘え、F2 ループ忘却、F3 rubric 消失、F4 基準緩和、F5 スコアだけ上昇、F6 早期 FINAL 宣言、F7 無限ループ、F8 根拠使い回し、F9 一気にジャンプ、F10 成果物差し替えを扱う。

**設計書参照**: `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T034, T011, T025, T017, T036, T035, T038

**変更**:

- `rubric-loop/server/test/failure_modes_1_10.test.js` (add)  — F1..F10 を1件1テストで検査

**受け入れ条件**:

- F1 に対し evidence 必須と auto 基準の kind 制限が効き E_EVIDENCE_REQUIRED と E_EVIDENCE_KIND が出ること
- F2 に対し全応答の next_action と状態機械の順序強制が効くこと
- F3 に対し loop_state が rubric 全文とアンカーを再供給すること
- F4 に対し緩和が記録され FINAL に到達不能になること
- F5 に対し E_SCORE_INFLATION が出ること
- F6 に対し自己申告が判定に影響せず ITERATING が強制されること
- F7 に対し max_rounds と停滞検知の2系統で STALLED になること
- F8 に対し E_EVIDENCE_STALE が出ること
- F9 に対し E_SCORE_JUMP が出て、command 根拠2件で解除されること
- F10 に対し artifact_commit → score_submit の順序強制と E_DIGEST_MISMATCH が効くこと

**検証コマンド**:

- `node --test rubric-loop/server/test/failure_modes_1_10.test.js` → 終了コード 0

**見積**: 3 周

### T073 テスト: 失敗モード F11 から F20 の対策が効くことを検査する

**狙い**: 設計書 2 の対応表の F11 から F20 について、塞ぐ機構が実際に効いていることを1件ずつ検査する。F11 引用捏造、F12 並行上書き、F13 サーバ不在の完了宣言、F14 二重採点、F15 上流の版を知らない、F16 古い合格の放置、F17 下流での辻褄合わせ、F18 設計外作業の混入、F19 テスト削除とアサート弱化、F20 チェーン暴走を扱う。

**設計書参照**: `2. 何を潰すのか — 失敗モードと対策の1対1対応`

**依存**: T034, T005, T049, T018, T023, T041, T043, T030, T032, T033, T024

**変更**:

- `rubric-loop/server/test/failure_modes_11_20.test.js` (add)  — F11..F20 を1件1テストで検査

**受け入れ条件**:

- F11 に対し E_EVIDENCE_NOT_FOUND が出ること
- F12 に対し expected_round の楽観ロックと LOCK により E_CONCURRENT が出ること
- F13 に対し SKILL.md の縮退規約が UNVERIFIED-COMPLETE への格下げを強制すること
- F14 に対し submission_id の冪等性で二重適用が起きないこと
- F15 に対し E_UPSTREAM_REQUIRED と E_UPSTREAM_DIGEST_MISMATCH が出ること
- F16 に対し FINAL でも SUPERSEDED に落ちること
- F17 に対し kickback で FROZEN になり下流だけ進む経路が無いこと
- F18 に対し E_PLAN_DESIGN_REF が出ること
- F19 に対し E_TEST_REGRESSION と E_TEST_MUTATED_WITHOUT_DIFF と E_TEST_NOT_GREEN が出ること
- F20 に対し E_CHAIN_BUDGET_EXHAUSTED が出ること

**検証コマンド**:

- `node --test rubric-loop/server/test/failure_modes_11_20.test.js` → 終了コード 0

**見積**: 3 周

### T074 テスト: 可搬性とスコープ外の混入がないことを検査する

**狙い**: スコープ外（CI 設定・配布・レンダリング・ベンダー固有前提）の成果物が混入していないこと、コンポーネントが skills/ と mcp.json の2種のままであることを検査する。可搬パッケージの前提が崩れていないことを機械的に守る。

**設計書参照**: `1.3 スコープ外` / `1.2 置いた仮定（仕様に無い／曖昧なので、依存しない形にした）` / `9.1 パッケージ構成` / `11.2 ベンダー固有前提を持ち込まない境界`

**依存**: T009, T019, T048

**変更**:

- `rubric-loop/server/test/portability.test.js` (add)  — コンポーネント種別・変数・資格情報・スコープ外を検査

**受け入れ条件**:

- パッケージ直下のコンポーネントが skills/ と mcp.json の2種だけであること
- mcp.json と mcp.http.json で展開される変数が ${PLUGIN_ROOT} と ${PLUGIN_DATA} の2種のみであること
- パッケージ内に資格情報（token / key / secret / password を名に持つ値）が1件も無いこと
- cwd が PLUGIN_ROOT または PLUGIN_DATA の配下に閉じていること
- CI 設定ファイル・配布用スクリプト・レンダリング関連ファイルがパッケージに含まれないこと
- server/src 配下に vendor 固有の環境変数名が mcp.json 経由で現れないこと

**検証コマンド**:

- `grep -rn 'CLAUDE_PLUGIN' rubric-loop/mcp.json rubric-loop/mcp.http.json` → 終了コード 1（ベンダー別名が mcp.json に無いこと）
- `node --test rubric-loop/server/test/portability.test.js` → 終了コード 0

**見積**: 2 周

### T075 テスト: 既定値表の全項目がコードと一致することを検査する

**狙い**: 16 の既定値まとめの各行を1件のアサートに落とし、defaults.js の値と突き合わせる。実装時に値を決め直す余地を残さないための最後の関門にする。

**設計書参照**: `16. 既定値まとめ（実装時に決め直さない）` / `17. 未解決事項として残さないための注記` / `7.2 既定値と根拠`

**依存**: T020, T019, T008

**変更**:

- `rubric-loop/server/test/defaults_table.test.js` (add)  — 既定値表の各行を1アサートに対応させる

**受け入れ条件**:

- 16 の表の各行に対応するアサートが1つ以上存在すること
- モード別 max_rounds / stall_window / stall_epsilon の9値がすべて一致すること
- chain_max_rounds 28 / chain_extra_rounds 6 / chain_max_kickbacks 2 が一致すること
- submission_id の長さ範囲 8 から 128 と、適用ツールが loop_open / artifact_commit / score_submit / rubric_amend / escalate の5本であることが一致すること
- tools/list の ttlMs 86400000 と cacheScope private、および固定ツール順序が一致すること
- fileset の 5000 / 1024 / 2097152 と plan の 200 が一致すること

**検証コマンド**:

- `node --test rubric-loop/server/test/defaults_table.test.js` → 終了コード 0

**見積**: 2 周

### T076 テスト: 全モジュール横断の回帰スイートを1コマンドで走らせる

**狙い**: server/test 配下の全テストを1コマンドで実行し、途中で停止した場合にどのタスクまで完了しているかが判別できるようにする。部分実装でも常にビルド可能かつテスト緑であることをここで担保する。

**設計書参照**: `9.1 パッケージ構成` / `1.1 動かせない前提`

**依存**: T050, T067, T068, T071, T072, T073, T074, T075

**変更**:

- `rubric-loop/server/package.json` (modify)  — scripts.test に node --test を追加
- `rubric-loop/server/test/smoke.test.js` (add)  — パッケージ骨格と7ツールの疎通のみを見る最小スイート

**受け入れ条件**:

- rubric-loop/server で node --test を実行すると全テストが緑で終わること
- smoke.test.js だけを単独実行しても緑で終わること
- 未実装のタスクがある段階でも、実装済みタスクのテストは緑のまま実行できること
- テストが PLUGIN_DATA を一時ディレクトリに向け、利用者の実データを汚さないこと

**検証コマンド**:

- `node --test rubric-loop/server/test` → 終了コード 0（全数実行）
- `node --test rubric-loop/server/test/smoke.test.js` → 終了コード 0

**見積**: 2 周

## KICKBACK（設計書 rev.3 へ差し戻した欠陥7件。rev.4 で全件解消済み）

以下は設計書 rev.3 の記述に見つかった不整合である。当時は設計書が凍結されていたため本計画では辻褄合わせをせず、ここに分離して記載した。7件はすべて設計書 rev.4（20.5）で解消され、本計画は rev.4 の記述に追随済みである。記録として、何を差し戻し、上流がどう直したかを残す。

| # | 該当節（rev.3 時点） | 状態 |
|---|---|---|
| KB-1 | 2. 何を潰すのか — 失敗モードと対策の1対1対応 | rev.4 で解消 |
| KB-2 | 9.3 `mcp.json`（実物・stdio 既定） / 9.4 `mcp.json`（streamable-http 版） | rev.4 で解消 |
| KB-3 | 8.4 書き込みの原子性と並行性 | rev.4 で解消 |
| KB-4 | 19.5.2 `artifact_kind: "plan"` — 計画の型 | rev.4 で解消 |
| KB-5 | 19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数） | rev.4 で解消 |
| KB-6 | 13. 受け入れテスト | rev.4 で解消 |
| KB-7 | 16. 既定値まとめ（実装時に決め直さない） / 7.2 既定値と根拠 | rev.4 で解消 |

### KB-1（解消済み）

- **該当節（rev.3 時点）**: 2. 何を潰すのか — 失敗モードと対策の1対1対応
- **欠陥**: 失敗モード表の行が F1…F12, F14, F13, F15… の順に並んでおり、F14 が F13 より前にある。番号で参照する箇所（19.8.2 など）と読み合わせるときに行を取り違える。
- **差し戻し時の提案**: F13 と F14 の行を入れ替えて昇順にする。番号を振り直すと既存の参照が全部ずれるので、行順のみを直す。
- **rev.4 での解消**: F13 と F14 の行順を入れ替えて昇順にした。番号は振り直していないので既存の参照はすべて有効。

### KB-2（解消済み）

- **該当節（rev.3 時点）**: 9.3 `mcp.json`（実物・stdio 既定） / 9.4 `mcp.json`（streamable-http 版）
- **欠陥**: 同名 `mcp.json` の実物が2つ示されているが、9.1 のパッケージ構成では `mcp.json` は固定位置に1つしか置けない。streamable-http 版をどのファイル名で同梱するのか、あるいは同梱せず手順書だけにするのかが未規定。
- **差し戻し時の提案**: 9.1 の構成図に任意版のファイル名（例: `mcp.http.json`）を追記し、既定は `mcp.json` であること、切り替えは利用者がリネームすることを 9.4 に明記する。
- **rev.4 での解消**: 9.1 の構成図に `mcp.http.json` を追加し、既定は `mcp.json`（stdio）、切り替えは利用者のリネームであることを 9.4 に明記した。`mcp.http.json` は固定位置ではないためコンポーネントとして発見されない。本計画では T009 が採用している。

### KB-3（解消済み）

- **該当節（rev.3 時点）**: 8.4 書き込みの原子性と並行性
- **欠陥**: LOCK に含める `boot_id` の取得方法が規定されていない。Linux の /proc/sys/kernel/random/boot_id は移植性が無く、Windows と macOS での定義が無いまま「再起動をまたいだ陳腐 LOCK の判別」を要求している。
- **差し戻し時の提案**: boot_id を「OS が提供する場合はそれを使い、無い場合は PLUGIN_DATA 直下に起動時 UUID を保存して代用する」と 8.4 に定義し、代用時は陳腐化判定が 60 秒のみに縮退することを明記する。
- **rev.4 での解消**: 8.4 に boot_id の3経路（OS 起動識別子 / 起動時刻の UUIDv5 / `PLUGIN_DATA/instance_id` 代用）と `boot_id_source` の記録を定義し、代用時は陳腐化判定が 60 秒経過のみに縮退することと `warnings` に `lock_staleness_time_only` を出すことを明記した。本計画では T005 が実装する。

### KB-4（解消済み）

- **該当節（rev.3 時点）**: 19.5.2 `artifact_kind: "plan"` — 計画の型
- **欠陥**: task スキーマの `required` に `design_refs` が入っていないのに、同節の機械検査は「すべての `design_refs` が上流に実在すること」を求めている。`design_refs` を持たないタスクが合法なのか、`E_PLAN_INVALID` なのかが決まっていない。
- **差し戻し時の提案**: `design_refs` を `required` に加えるか、機械検査側に「`design_refs` 欠落は `E_PLAN_INVALID`」を1行足すかを選び、どちらかに確定する。設計外作業の混入（F18）を塞ぐ意図からは前者が整合する。
- **rev.4 での解消**: `design_refs` を task スキーマの `required` に加えた（提案のうち前者を採用）。欠落・空配列は `E_PLAN_SCHEMA`、実在しない参照は `E_PLAN_DESIGN_REF` と役割が分かれた。本計画では T028 と T030 に反映済み。

### KB-5（解消済み）

- **該当節（rev.3 時点）**: 19.6.7 全7ツール総覧（名前・目的・入力／出力スキーマの所在・エラー条件の全数）
- **欠陥**: `score_submit` の18件に `E_VALIDATION` が無い。一方 6.3 の共通エラー条件は `E_VALIDATION` を全ツール共通として挙げており、rationale 40 文字未満のような入力不備がどのコードになるのかが2節で食い違う。
- **差し戻し時の提案**: 総覧の各行が「共通6件を含む全数」なのか「ツール固有の追加分」なのかを 19.6.7 の冒頭で定義し、`score_submit` の行に `E_VALIDATION` を含めるか除くかを明示する。
- **rev.4 での解消**: 19.6.7 の冒頭に「共通エラー条件を含む全数（`E_INTERNAL` のみ除外）」という行の定義を置き、`score_submit` を18件→19件、`loop_state` を1件→2件にして `E_VALIDATION` を追加した。定義済み42件は不変。本計画では T010 と T025 に反映済み。

### KB-6（解消済み）

- **該当節（rev.3 時点）**: 13. 受け入れテスト
- **欠陥**: AT-1 から AT-9 の見出しが「AT-1 正常収束（1本）」形式、AT-10 から AT-18 が「AT-10: 3モード連鎖の正常系」形式で、区切り文字と本数表記が揃っていない。見出し文字列で機械照合するときに規則を2つ持たされる。
- **差し戻し時の提案**: どちらかの記法に統一する。既存の参照は節番号ではなく AT 番号で行われているため、見出し文字列だけを揃えれば参照は壊れない。
- **rev.4 での解消**: 全18件を `AT-<番号>: <目的>` の一形式に統一した（`（1本）` は「1 AT = 1本」として 13 の冒頭に集約）。本計画の T050–T058 の design_refs もこの表記に追随させた。

### KB-7（解消済み）

- **該当節（rev.3 時点）**: 16. 既定値まとめ（実装時に決め直さない） / 7.2 既定値と根拠
- **欠陥**: `stall_epsilon` は 16 で implement のみ 0.20 と定められているが、7.2 の根拠表は 0.25 の理由しか述べておらず、0.20 を選んだ理由が文書内に無い。19.10.1 のモード別の値と理由にも 0.20 の根拠が見当たらない。
- **差し戻し時の提案**: 19.10.1 に implement の `stall_epsilon` を 0.20 にした理由（1周あたりの改善幅が設計・計画より小さいなど）を1行足す。値そのものは変えない。
- **rev.4 での解消**: 19.10.1 にモード別の値と理由の表を置き、0.20 を重み配置から導出して示した（implement は重み合計22なので「重み2と3の基準が各 +1」= 5/22 ≒ 0.227 が 0.25 では停滞と誤判定される）。7.2 と 16 からも 19.10.1 を参照するようにした。値は変わっていないので本計画に影響は無い。
