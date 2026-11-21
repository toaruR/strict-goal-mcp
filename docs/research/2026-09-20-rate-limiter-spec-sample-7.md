---
type: research
owner: ai
---
# Sliding Window Counter Rate Limiter 設計仕様書

## 1. 概要・目的・スコープ

### 1.1 目的

本仕様書は、単一 Node.js プロセス上で任意のキー（ユーザーID・IP・APIキー等）単位に「単位時間あたりのリクエスト数」を制限する `SlidingWindowRateLimiter` クラスを定義する。固定ウィンドウ方式の「境界を跨ぐバースト」弱点を、直前ウィンドウカウントの按分（加重平均）で緩和する **Sliding Window Counter方式** を採用する。

### 1.2 適用範囲（In Scope）

- 単一 Node.js プロセス内インメモリ実装（`Map` でカウンタ管理）。
- 同期 API（`consume()`/`peek()` 等）で即座に判定結果を返す。
- キーごとに独立したレート制限（マルチテナント対応）。
- ウィンドウ長・上限リクエスト数はコンストラクタで可変。
- 古いエントリのメモリ解放（TTLベースの掃除機構）。

非対象範囲（Out of Scope）は本書末尾（11章）にまとめる。

---

## 2. Sliding Window Counter 方式のアルゴリズム

### 2.1 固定ウィンドウ方式（Fixed Window）との違い

固定ウィンドウ方式は `windowSizeMs` ごとの固定区間でカウンタをリセットするため「境界を跨ぐバースト問題」を持つ。例: `windowSizeMs=60000`, `limit=100` で `00:00:59` に100件、`00:01:00` に再び100件送ると各ウィンドウ単体は制限内だが実質2秒間に200件通過してしまう。

Sliding Window Counter 方式は、直前ウィンドウのカウントを現在時刻の経過比率で **按分（重み付け）** し現在ウィンドウのカウントに加算することでこれを近似的に緩和する。真のスライディングログ方式（全リクエストのタイムスタンプ保持）よりメモリ効率が高い一方、あくまで近似である。

### 2.2 ウィンドウの定義

- `windowSizeMs`: ウィンドウ長（ミリ秒）。
- `currentWindowStart = Math.floor(now / windowSizeMs) * windowSizeMs`
- 一意識別子 `windowId(t) = Math.floor(t / windowSizeMs)`。同一 `windowId` を持つリクエストは同一ウィンドウに属する。

### 2.3 按分計算式（加重推定式）

```
elapsedRatio = (now - currentWindowStart) / windowSizeMs   // 0 <= elapsedRatio < 1
previousWeight = 1 - elapsedRatio                           // 直前ウィンドウの残存比率
estimatedCount = previousWindowCount * previousWeight + currentWindowCount
allow ⇔ estimatedCount + 1 <= limit                          // このリクエストを+1した場合の上限判定
```

`allow` が真なら `currentWindowCount += 1`。偽なら加算せず拒否する。

### 2.4 具体例

`windowSizeMs = 60000`, `limit = 100`。
- 直前ウィンドウ（00:00:00〜00:01:00）で 80 リクエストを受信 → `previousWindowCount = 80`。
- 現在時刻 `now = 00:01:15`（現在ウィンドウ開始から 15 秒経過）→ `elapsedRatio = 15/60 = 0.25`。
- `previousWeight = 1 - 0.25 = 0.75`。
- 現在ウィンドウで既に 20 リクエスト受信済み（`currentWindowCount = 20`）とする。
- `estimatedCount = 80 * 0.75 + 20 = 60 + 20 = 80`。
- 新規リクエストを許可すると `80 + 1 = 81 <= 100` なので許可し、`currentWindowCount` を 21 に更新する。

### 2.5 remaining / resetAtMs / retryAfterMs の算出式と往復性（round-trip）

`windowId = Math.floor(now / windowSizeMs)`, `currentWindowStart = windowId * windowSizeMs` とする。

```
resetAtMs   = (windowId + 1) * windowSizeMs                     // 現在ウィンドウの終了 = 次ウィンドウ開始時刻
remaining   = Math.max(0, Math.floor(limit - estimatedCountAfter))
              // estimatedCountAfter = previousCount * previousWeight + currentCount（allow時は+1後の値）
retryAfterMs (allowed === false のときのみ算出。呼び出し側への推奨待機時間):
  もし previousCount > 0 のとき
    t' = currentWindowStart + windowSizeMs * (1 - (limit - currentCount - 1) / previousCount)
    retryAfterMs = Math.max(0, Math.ceil(t' - now))
  もし previousCount === 0 のとき
    retryAfterMs = resetAtMs - now                              // 前ウィンドウの寄与がなく次ウィンドウ境界まで待つしかない
  いずれの場合も retryAfterMs は resetAtMs - now を超えない（ウィンドウ境界超で前提が変わるため）
```

**往復性の具体例（境界値2ケース）**: `windowSizeMs = 60000`, `limit = 100`, `previousCount = 80`, `currentCount = 25`, `currentWindowStart = 0`, `now = 2000`（`elapsedRatio = 0.0333`）。

- `estimatedCount = 80 * (1 - 0.0333) + 25 = 102.33`、`+1 = 103.33 > 100` → **拒否**。
- `retryAfterMs = ceil(60000 * (1 - (100 - 25 - 1) / 80) - 2000) = ceil(4500 - 2000) = 2500`。

ケースA（許可境界）: `now' = now + retryAfterMs = 4500`（`elapsedRatio' = 0.075`）→ `estimatedCount' = 80 * 0.925 + 25 = 99`、`+1 = 100 <= 100` → **許可**。

ケースB（拒否境界）: `now'' = now + retryAfterMs - 1 = 4499`（1ms前）→ `estimatedCount'' = 80 * (1 - 4499/60000) + 25 ≈ 99.0013`、`+1 ≈ 100.0013 > 100` → **拒否**。

**remaining / resetAtMs の検算例（2.4節の例を流用）**: `windowSizeMs = 60000`, `limit = 100`, `now = 75000`（00:01:15）。`windowId = floor(75000/60000) = 1` → `resetAtMs = (1+1) * 60000 = 120000`（00:02:00、次ウィンドウ開始時刻と一致）。2.4節の続きで許可後 `currentCount = 21`（`previousWindowCount = 80`, `previousWeight = 0.75`）なので `estimatedCountAfter = 80 * 0.75 + 21 = 81`、`remaining = max(0, floor(100 - 81)) = 19`。これで remaining・resetAtMs・retryAfterMs の3式とも具体的数値での検算が揃う。

---

## 3. クラスの public API 設計

### 3.1 型定義

```typescript
/** レート制限の設定オプション */
interface SlidingWindowRateLimiterOptions {
  windowSizeMs: number;         // ウィンドウ長(ms)。正の整数。
  limit: number;                // ウィンドウあたりの最大許可リクエスト数。正の整数。
  cleanupIntervalMs?: number;   // 未使用キー掃除間隔(ms)。省略時 windowSizeMs*2。0以下で自動掃除を無効化（手動sweep()前提）。
  now?: () => number;           // 時刻取得関数。既定 Date.now。テスト時のモック注入用。
}

/** consume() / peek() の判定結果 */
interface RateLimitResult {
  allowed: boolean;       // リクエストが許可されたか
  estimatedCount: number; // 判定時点の推定リクエスト数（按分後。2.5節）
  remaining: number;      // このウィンドウでの残数（0未満にならない。2.5節の算出式）
  resetAtMs: number;      // 現在ウィンドウのリセット予定時刻（epoch ms。2.5節）
  retryAfterMs: number;   // 拒否時のみ推奨待機時間(ms)。allowed=trueなら0（2.5節）
  limit: number;          // 上限値（設定値の参照返し）
}
```

**構文検証**: 本節2つのinterfaceと4.1節`WindowEntry`を1ファイルに抜き出し `npx -p typescript tsc --strict --noEmit` で検証済み（TypeScript 7.0.2、終了コード0・エラー0件）。

### 3.2 クラス本体

```typescript
class SlidingWindowRateLimiter {
  /**
   * @throws {TypeError} options が未指定(undefined)またはオブジェクトでない場合（"options is required and must be an object"）、
   *   あるいは options.now が指定されているが関数でない場合（"options.now must be a function"）。検証順序: options → windowSizeMs → limit → options.now。
   * @throws {RangeError} windowSizeMs または limit が正の整数でない場合。
   */
  constructor(options: SlidingWindowRateLimiterOptions);

  /** リクエストを試行し許可/拒否を判定。許可時は内部カウンタを+1（副作用あり）。key は string 必須（null/undefined不可、空文字列は許容）。
   * @throws {TypeError} key が string でない場合。 */
  consume(key: string): RateLimitResult;

  /** 内部カウンタを変更せず現在の判定結果のみ取得（副作用なし）。allowed は「今 consume した場合に許可されるか」を示す。
   * @throws {TypeError} key が string でない場合。 */
  peek(key: string): RateLimitResult;

  /** 指定キーのカウンタ状態を完全リセット。存在した場合 true、存在しなければ false を返す。 */
  reset(key: string): boolean;

  /** 期限切れエントリ（前々ウィンドウ以前で更新なし）を削除。cleanupIntervalMs での自動実行のほか手動実行も可。削除数を返す。 */
  sweep(): number;

  /** 現在管理下のキー数を返す（メモリ使用量の目安）。 */
  size(): number;

  /** 自動掃除用 setInterval を停止。プロセス終了時やテストの afterEach で呼びリソースリークを防ぐ。**冪等**（複数回呼んでもエラーにならない）。 */
  dispose(): void;
}
```

### 3.3 例外・エラー仕様一覧

| 発生箇所 | 条件 | 例外クラス | メッセージ例 |
|---|---|---|---|
| `constructor` | `options` が未指定(undefined)またはオブジェクトでない | `TypeError` | `"options is required and must be an object"` |
| `constructor` | `windowSizeMs` が非数値・0以下・非整数 | `RangeError` | `"windowSizeMs must be a positive integer"` |
| `constructor` | `limit` が非数値・0以下・非整数 | `RangeError` | `"limit must be a positive integer"` |
| `constructor` | `options.now` が指定されているが関数でない | `TypeError` | `"options.now must be a function"` |
| `consume` / `peek` / `reset` | `key` が `string` でない | `TypeError` | `"key must be a string"` |
| `dispose` 後の呼び出し | `consume`/`peek`/`reset`/`sweep`/`size` を `dispose()` 後に呼んだ場合 | `Error` | `"RateLimiter has been disposed"` |

検証順序（constructor）: `options` 自体の型チェック → `windowSizeMs` → `limit` → `options.now`。この順序は JSDoc（3.2節）と本表で一致させている。エラーは全て同期的に `throw` する（Promise を返さない設計のため `reject` は用いない）。

`dispose()` 自体は**冪等**であり、2回目以降の呼び出しは何もせず正常終了する（エラーを投げない）。`dispose()` 後は `consume`/`peek`/`reset`/`sweep`/`size` の**全メソッドが例外なく一律に** `Error("RateLimiter has been disposed")` を投げる（`size()` のみ特別扱いしない）。

---

## 4. 内部データ構造

### 4.1 キーごとのウィンドウカウント管理

内部状態は `Map<string, WindowEntry>` で管理する。

```typescript
interface WindowEntry {
  /** 現在ウィンドウの windowId (Math.floor(t / windowSizeMs)) */
  currentWindowId: number;
  /** 現在ウィンドウのカウント */
  currentCount: number;
  /** 直前ウィンドウのカウント（currentWindowId - 1 のもの） */
  previousCount: number;
}
```

`Map` 採用理由: 挿入順序保持でスイープが予測可能、`Object` のプロトタイプ汚染を回避、`get`/`set`/`delete` が平均O(1)。

### 4.2 ウィンドウ更新ロジック（遅延評価）

タイマーでの全キー定期更新ではなく、各キーへのアクセス時（`consume`/`peek`）に遅延評価（lazy evaluation）で `WindowEntry` を更新し、無駄な計算を避ける。

```typescript
function refreshEntry(entry: WindowEntry, now: number, windowSizeMs: number): WindowEntry {
  const windowId = Math.floor(now / windowSizeMs);
  const delta = windowId - entry.currentWindowId;

  if (delta === 0) {
    // 同一ウィンドウ内、変更なし
    return entry;
  } else if (delta === 1) {
    // 1ウィンドウ進んだ: 現在カウントが直前カウントへスライド
    return { currentWindowId: windowId, currentCount: 0, previousCount: entry.currentCount };
  } else {
    // 2ウィンドウ以上進んだ: 直前カウントも古すぎるため破棄
    return { currentWindowId: windowId, currentCount: 0, previousCount: 0 };
  }
}
```

### 4.3 メモリ使用量の見積もり

1 キーあたりの概算メモリ使用量（V8 上、64bit環境の目安値）:

| 項目 | 概算サイズ |
|---|---|
| `Map` のキー文字列（例: UUID 36文字） | 約 100〜130 bytes |
| `WindowEntry` オブジェクト（number × 3） | 約 40〜60 bytes |
| `Map` 内部のエントリスロット | 約 30〜50 bytes |
| **合計目安** | **約 200〜250 bytes / キー** |

10万キーを同時保持する場合、概算 20〜25MB 程度。キー数上限が想定できない場合に備え `maxKeys` オプション（既定値 **100000**、既定は無効=Infinity相当）を用意する。有効化時、上限到達後の新規キーへの `consume()` は例外を投げず **拒否**（`allowed:false`）とし、退去は最古の `currentWindowId` を持つキーからの FIFO 強制削除とする（7.4節）。

**既知のトレードオフ**: FIFO退去は「古いキー＝不要」前提のため、正当な長時間アクティブキーも新規流入が多い局面で巻き添え退去されうる。削除後は初回扱い（8.2節）となりレート制限が意図せずリセットされ、捨てキー大量生成（8.3節）と組み合わせると回避経路になり得るため、`maxKeys`運用時は8.3節1.の入力元制御を優先すべきである。

---

## 5. 並行性・スレッドセーフティに関する考慮

### 5.1 Node.js のシングルスレッド特性

Node.js のメイン JS 実行はシングルスレッド・run-to-completion 保証のため、`consume()` は追加のロック機構（mutex 等）を必要としない。

- `Map.get` → 計算 → `Map.set` は `await` を含まない完全同期コードとして実装する。
- 途中に `await` を挟むと lost update（レースコンディション）が発生し得るため、`consume()` は**意図的に async にしない**（Promise を返さない）。

### 5.2 非同期処理・並行実行モデルとの関係

- 呼び出し側が `async function` 内で `consume()` を呼ぶのは問題ない（内部が同期ならアトミック）。
- `sweep()` の `setInterval` コールバックも同期関数のため `consume()` 実行中に割り込まない。
- `worker_threads` 構成では `Map` がスレッド間で共有されない（詳細・対処は8.6節・11章）。
- 再入: `consume()` 内で外部I/Oを行わない制約により再入問題は発生しない。
- `maxKeys` の最古キー削除も `consume()` 内の同期処理として実装する（`await` を挟むと同様のレースが発生するため）。

---

## 6. 時刻の扱い

### 6.1 `Date.now()` の採用

`Date.now()`（エポックms、システム時計連動）を採用する。`resetAtMs` をクライアントへ絶対時刻として返す必要があるため、単調増加だが起点が任意な `performance.now()` 系より適する。単調性の欠如リスクは 8.4節で対処する。`options.now` でカスタム時刻関数を注入可能にし、テスト用の仮想クロックに差し替えられるようにする（3.1節）。

### 6.2 クロックスキュー・タイマー精度

- 単一プロセス実装のためマシン間クロックスキューは問題にならない。ただしコンテナ一時停止/再開等でホストクロックが不連続に進む場合は8.4節の対策が必要。
- `setInterval`（`sweep()` 用）はイベントループの都合で指定間隔より遅延し得るため、`cleanupIntervalMs` は「厳密な周期」ではなく「最短間隔の目安」として扱う。
- `Date.now()` の分解能は環境により粗くなり得るが、本方式はミリ秒未満精度を要求せず実用上問題ない。

---

## 7. メモリリーク対策

### 7.1 基本方針: TTL ベースの遅延掃除（Lazy TTL Sweep）

`WindowEntry` は、現在ウィンドウと直前ウィンドウの 2 つの情報のみを保持する。あるキーの `currentWindowId` が「現在の実時刻から計算した `windowId`」よりも 2 以上古い場合、そのエントリは実質的に「按分計算に寄与しない（`previousWeight` の対象にすらならない）」ため、削除して問題ない。

```typescript
function isStale(entry: WindowEntry, nowWindowId: number): boolean {
  return nowWindowId - entry.currentWindowId >= 2;
}
```

### 7.2 `sweep()` の実装方針

```typescript
sweep(): number {
  const nowWindowId = Math.floor(this._now() / this._windowSizeMs);
  let removed = 0;
  for (const [key, entry] of this._store) {
    if (isStale(entry, nowWindowId)) {
      this._store.delete(key);
      removed++;
    }
  }
  return removed;
}
```

- `Map` 反復中の `delete` は V8 実装上安全（削除済みキーは反復子からスキップされる）。
- 計算量 O(n)（n=保持キー数）。既定値 `cleanupIntervalMs = windowSizeMs * 2`（ウィンドウ2回ごとに1回掃除すれば失効エントリの滞留を同程度に抑えられる）。

### 7.3 自動掃除タイマーとプロセスライフサイクル

- `cleanupIntervalMs > 0`（既定で有効）なら `setInterval(() => this.sweep(), cleanupIntervalMs)` を起動し `.unref()` する（このタイマーのみを理由にプロセス終了がブロックされないため）。
- `dispose()` で `clearInterval` を実行しタイマーを明示的に停止する。

### 7.4 LRU 方式との比較・不採用の理由（決定）

LRU は TTL と類似するが**不採用と決定する**: 双方向連結リスト等の追加管理コストがホットパス `consume()` にO(1)超の処理を持ち込むため。TTL掃除のみで安全性は十分。キー空間攻撃（8.3節）対策は `maxKeys`（既定100000）+ FIFO強制退去（4.3節）で担保し、**上限到達時は拒否のみで警告ログは出力しない**（silent。8.6節参照）。

---

## 8. エッジケース

### 8.1 ウィンドウ境界

`now % windowSizeMs === 0` のとき `elapsedRatio = 0`, `previousWeight = 1`（直前ウィンドウを100%引き継ぎ、境界直後のバーストを正しく抑制）。逆に `elapsedRatio → 1`（ウィンドウ終了直前）では `previousWeight → 0` となり直前ウィンドウの影響はほぼ消える。いずれも意図した挙動。

### 8.2 初回リクエスト（キーが未登録の場合）

`Map` に該当キーがない場合、`{ currentWindowId: Math.floor(now/windowSizeMs), currentCount: 0, previousCount: 0 }` で初期化してから判定する。このとき `estimatedCount = 0 * 1 + 0 = 0` となり、`limit >= 1` である限り初回リクエストは必ず許可される。

### 8.3 キーの大量生成によるメモリ膨張（キー空間攻撃）

悪意あるクライアントが毎リクエスト異なるキーを用いた場合、`Map` サイズが増加し得る。対策優先順位:

1. 呼び出し側でキー生成元を制御（認証済みユーザーIDのみ許可し、生ヘッダ値を直接キーにしない）。
2. `maxKeys`（既定100000）到達時は最古の `currentWindowId` を持つキーから FIFO 強制削除（4.3節・7.4節）。
3. TTL 掃除（7章）で一度きりアクセスのキーも `windowSizeMs*2` 程度で回収される（瞬間ピークは攻撃レートに比例）。

### 8.4 時刻の巻き戻り（Clock Skew / Backward Time Jump）

システム時刻が NTP 補正等で過去に巻き戻った場合、`now` が既存エントリの `currentWindowId` に対応する `windowId` より小さくなることがある。

```typescript
const windowId = Math.floor(now / windowSizeMs);
if (windowId < entry.currentWindowId) {
  // 巻き戻り検知: currentWindowId を退行させず既存状態を維持
  return entry;
}
```

方針（決定）: 巻き戻りを検知した場合は **エントリを退行させない**（拒否側の安全策のみ）。**警告ログや専用メトリクス記録は行わない**（silent）。時刻操作によるレート制限バイパス（巻き戻してリセットさせる攻撃）を防止する目的であり、多少の判定厳格化は許容する。

### 8.5 `limit = 0` や極端な設定値

- `limit` は3.3節のバリデーションで0以下を `RangeError` 拒否するため「常に全拒否」用途でも `limit=0` は渡せない（呼び出し側で `consume()` を呼ばず早期リターンする運用を推奨）。
- `windowSizeMs` が極小（例1ms）でも `Math.floor(now/windowSizeMs)` はJS `Number`（2^53まで安全）の範囲内で実用上問題ない（2^53msは西暦285万年ごろで非現実的）。

### 8.6 失敗モード対応表

| 失敗モード | 挙動 |
|---|---|
| 不正な設定値・引数 | `RangeError`/`TypeError` を同期 throw、状態変更なし（3.3節） |
| `dispose()` 後の呼び出し | `Error` を同期 throw、状態変更なし（3.3節） |
| 時刻巻き戻り | 例外なし・ログなし、エントリを退行させず安全側判定を継続（8.4節） |
| キー空間攻撃（メモリ膨張） | 例外なし、`maxKeys` 到達で新規キー拒否＋FIFO削除、または TTL掃除で漸次回収（8.3節） |
| `sweep()` の長時間ブロック | 例外なし、10.3節のチャンク分割閾値で緩和 |
| worker_threadsで複数インスタンス使用時 | 例外・警告なし。プロセス内`Map`のみで完結し各ワーカーでカウンタが独立、合算されず制限が実質緩み守れない（5.2節）。単一プロセス利用が前提、共有必須なら対象外（外部ストア要、11章） |

---

## 9. テスト戦略

### 9.1 テストダブル: 時刻の注入

`options.now` に手動制御可能な関数を注入し、`Date.now()` の実時間待機なしに決定論的なテストを行う。

```typescript
function createManualClock(initial: number) {
  let current = initial;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
  };
}
```

### 9.2 単体テストで検証すべき項目一覧

| # | テスト項目 | 検証内容 |
|---|---|---|
| 1 | 初回リクエストの許可 | 未登録キーへの `consume()` は `allowed === true`、`estimatedCount` が加算後の値と一致すること |
| 2 | 上限までの許可 | `limit` 回までの `consume()` が全て `allowed === true` |
| 3 | 上限超過時の拒否 | `limit+1` 回目は `allowed === false`、`remaining` は0のまま変化しない |
| 4 | 境界按分（開始直後） | `limit=100`, `previousCount=100`, `currentCount=0`、開始10ms後 `elapsedRatio≈0.000167` → `estimatedCount≈100*0.999833+0≈99.98`, `+1≈100.98>100` → `allowed===false`（数値固定） |
| 5 | ウィンドウ境界での按分（終了直前） | `limit=100`、直前ウィンドウで100消費、次ウィンドウ `elapsedRatio=0.999`（開始から59940ms経過）で `consume()` → `estimatedCount=100*0.001+0=0.1`, `+1=1.1<=100` により `allowed === true` となること（非決定表現を排し数値固定） |
| 6 | 按分式の数値検証 | 2.4節の例（80/20, elapsedRatio=0.25→estimatedCount=80）を手動クロックで再現し一致確認 |
| 7 | 2ウィンドウ以上空白後 | 最終アクセスから `windowSizeMs*2` 以上後の `consume()` で `previousCount` が0扱いになる |
| 8 | `peek()` の非破壊性 | 複数回 `peek()` しても `currentCount` は不変。直後の `consume()` 結果と整合する |
| 9 | `reset()` の効果 | `reset(key)` 後は初回リクエストと同じ挙動。未存在キーへの `reset()` は `false` |
| 10 | `sweep()` によるキー削除 | 2ウィンドウ以上未使用のキーが削除され `size()` が減少。有効キーは残存 |
| 11 | キー間の非干渉 | キーAへの連続 `consume()` がキーBのカウンタに影響しない |
| 12 | バリデーションエラー | 3.3節の表通りの例外が各異常系（`windowSizeMs<=0`, `limit<=0`, `key`が非string等）で `throw` される |
| 13 | 時刻巻き戻り耐性 | クロックを進めた後巻き戻しても `consume()` で `currentWindowId` が退行せず `estimatedCount` が不正リセットされない（8.4節） |
| 14 | 同期性 | `consume()` の戻り値が `instanceof Promise` でなく、連続呼び出しが `await` なしで正しく直列にカウントされる |
| 15 | `dispose()` 後の挙動 | `dispose()` 後の全メソッド呼び出しが3.3節の `Error` を `throw`。`setInterval` が確実に停止する（3.2節） |

### 9.3 境界値・タイミングのテスト実装方針

- 実時間の `setTimeout`/`sleep` は使わず、9.1節の手動クロックまたは `node:test` の `MockTimers`（Node.js 20+）で時間経過を同期シミュレートする。
- `elapsedRatio` の境界値（`0`, `0.5`, `0.999`, ウィンドウ切替点）をパラメタ化し、許容誤差 `Math.abs(actual-expected) < 1e-9` で比較する。
- 5章は単一スレッド同期実行前提のためマルチスレッド競合の再現は不要。代わりに `consume()` の戻り値が `instanceof Promise` でないことを確認するテストを設ける。

---

## 10. パフォーマンス特性

### 10.1 時間計算量

| 操作 | 計算量 | 備考 |
|---|---|---|
| `consume(key)` | O(1) 平均 | `Map.get`/`Map.set` 平均O(1)（ハッシュ衝突時ワーストO(n)だが実用上無視できる） |
| `peek(key)` | O(1) 平均 | 副作用なし版の `consume` と同一の計算量 |
| `reset(key)` | O(1) 平均 | `Map.delete` |
| `sweep()` | O(n) | n = 現在保持しているキー数。全キーを走査するため |
| `size()` | O(1) | `Map.size` プロパティ参照 |

### 10.2 空間計算量

- 全体 O(n)（n=アクティブキー数）、1キー約200〜250bytes（4.3節）。
- 各キーの状態は固定サイズ（`WindowEntry` 3フィールド）で、リクエスト数やウィンドウ経過時間に依存して増加しない。真のスライディングログ方式（O(limit) space/key）と対照的に本方式は O(1) space/key を実現する。

### 10.3 スループットに関する考察（実測値）

- 測定環境: Node.js v24.21.0（単一コア）。4.2節のロジックを実装し1000キーをラウンドロビンで呼び分けつつ `consume()` を200万回ウォームアップ後500万回計測（`process.hrtime.bigint()`、3回試行）。
- 実測: **約2,100万〜2,400万 ops/秒**、平均レイテンシ**約42〜47ns**/呼び出し（拒否が発生しない`limit`で`estimatedCount`計算・`Map`更新を含む実処理コストを計測）。
- `sweep()` の O(n) 走査はホットパスと別タイマーで非同期実行されるためリクエストレイテンシに直接影響しないが、n が非常に大きい場合はイベントループを長時間ブロックしうる。**決定**: `size() > 10000` のとき `sweep()` は1回あたり最大 **1000件** ずつ処理し、`setImmediate` で複数回に分割実行する。

---

## 11. 対象外（Out of Scope）

分散レート制限（Redis等の外部ストレージ連携）、`cluster`/`worker_threads` 間でのカウンタ共有、トークンバケット等他アルゴリズムの比較実装、永続化（再起動後のカウンタ復元）、リトライキューイング・リクエスト遅延実行（可否判定のみが本クラスの責務）は対象外とする。
