---
type: research
owner: ai
---
# Sliding Window Counter Rate Limiter 設計仕様

## 1. 目的と前提

単一の Node.js プロセス内で、任意の文字列キーごとに呼出し回数を制限する同期 `RateLimiter` クラスを提供する。方式は Sliding Window Counter（SWC）である。SWC は現在の固定窓の回数と直前固定窓の回数を、現在窓で経過した割合に応じて重み付けし、連続的な窓境界を近似する。

このクラスはプロセス内メモリーだけを状態とする。全公開 API は同期的に終了し、Promise、I/O、タイマー待機を発生させない。

## 2. 公開型と既定値

```ts
export interface RateLimiterOptions {
  /** 1 窓に許可する回数。正の安全整数。 */
  limit: number;
  /** 固定窓の幅（ミリ秒）。正の安全整数。 */
  windowMs: number;
  /** 未使用キーを削除するまでの非活動時間（ミリ秒）。0 は自動削除しない。 */
  idleTtlMs?: number;
  /** 注入可能な時計。整数ミリ秒を返さなければならない。既定値は Date.now。 */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** 判定に使った SWC 推定回数。常に 0 以上の有限数。 */
  estimatedCount: number;
  /** allowed 時は 0、拒否時は次に許可され得る最小待機ミリ秒。 */
  retryAfterMs: number;
}

export class RateLimiter {
  constructor(options: RateLimiterOptions);
  check(key: string): RateLimitResult;
  reset(key?: string): void;
  prune(): number;
}
```

既定値と設定名の唯一の一覧を次に示す。Options 型、本文、実装で受理する設定名はこの表の 4 個だけであり、別名・追加設定は存在しない。

|設定名|必須性|既定値|意味|採用理由|
|---|---|---|---|
|`limit`|必須|なし|1 窓の許可回数|業務上の許容量を推測すると安全性と可用性のどちらかを不当に損なうため、明示指定に固定する。|
|`windowMs`|必須|なし|固定窓幅（ms）|時間粒度は要求特性に依存するため、暗黙の窓幅を持たせず明示指定に固定する。|
|`idleTtlMs`|任意|`0`|未使用キーの保持時間（ms）|状態を予期せず失効させないことを優先し、自動削除なしを既定にする。|
|`now`|任意|`Date.now`|整数 ms を返す時計関数|通常の Node.js 実行で追加設定なく利用でき、注入時だけ決定的テストを可能にする。|

`check` は許可なら現在窓のカウンターを 1 増やす。拒否ならカウンターを変更しない。`reset(key)` はそのキーだけを削除し、引数なしは全キーを削除する。`prune()` は現在時刻から `idleTtlMs` 以上非活動のキーを削除して削除件数を返す。`idleTtlMs=0` のとき `prune()` は常に 0 を返す。`constructor`、`check`、`reset`、`prune` はすべて同期 API であり、返却までに完了する。

## 3. 内部状態と時刻正規化

キーごとに次を保持する。時刻・カウンターは JavaScript の `number` で保持するが、入力・演算の安全性を検査する。

```ts
interface Bucket {
  /** 現在の固定窓の開始時刻。windowMs の倍数。 */
  windowStartMs: number;
  /** 直前固定窓で許可した回数。 */
  previousCount: number;
  /** 現在固定窓で許可した回数。 */
  currentCount: number;
  /** 最後にこのキーを check/reset 対象とした単調時刻。 */
  lastSeenMs: number;
}
```

コンストラクターは `limit`、`windowMs`、指定された `idleTtlMs` が有限の正（`idleTtlMs` は 0 可）安全整数であることを検査し、違反時は `RangeError` を送出する。さらに加算の精度を保証するため、`limit <= floor(Number.MAX_SAFE_INTEGER / 2)` を必須とする。`now` が関数でなければ `TypeError` を送出する。`check` と `reset(key)` のキーは空文字列を含む任意の文字列を許可するが、文字列以外は `TypeError` を送出する。

各時刻取得時、`now()` の返値が有限安全整数でなければ `RangeError` を送出する。状態を更新する前に検査するため、時計関数の失敗は部分更新を残さない。時計後退に対してはキーごとに `effectiveNow = max(rawNow, bucket.lastSeenMs)` と丸め、単調性を保つ。新規キーは `effectiveNow=rawNow` とする。これは過去に戻った時計で使用量を失効させない安全側の方針である。

固定窓開始は `floor(effectiveNow / windowMs) * windowMs` で求める。ただし商、積、差が安全整数でなければ `RangeError` とし、状態は変更しない。`windowMs` を割る演算自体で浮動小数の丸めを招かないよう、`effectiveNow <= Number.MAX_SAFE_INTEGER - (windowMs - 1)` を満たさない時刻も拒否する。この条件で窓開始・窓内経過時間が安全整数になる。

## 4. 窓遷移と SWC 判定

`elapsedMs = effectiveNow - windowStartMs`、`0 <= elapsedMs < windowMs` とする。窓開始が同じならカウンターは維持する。開始がちょうど 1 窓だけ進んだ場合は `previousCount=currentCount`、`currentCount=0` にする。2 窓以上進んだ巨大ジャンプでは、過去窓の寄与は完全に 0 なので `previousCount=0`、`currentCount=0` にする。その後 `windowStartMs` を新しい開始に更新する。従って非活動キーが残っていても、巨大ジャンプ後に古い利用量が復活しない。

重みを `remainingMs = windowMs - elapsedMs` とおく。判定前の推定回数は次式である。

```text
estimatedCount = currentCount + previousCount * remainingMs / windowMs
```

すべての項は非負であり、分子 `previousCount * remainingMs` が安全整数でない場合は `RangeError` とする。各カウンターは `limit` 以下である。前記の `limit` 上限により、`currentCount + previousCount + 1` も安全整数であり、加算による精度喪失を防ぐ。許可時の `currentCount + 1` が安全整数でない場合も `RangeError` を送出する。

要求を 1 件加えた後も上限以下のときだけ許可する。比較は丸めず、厳密に次を用いる。

```text
allowed ⇔ estimatedCount + 1 <= limit
```

許可時は `currentCount += 1` と `lastSeenMs=effectiveNow` を更新し、返却する `estimatedCount` は加算後の推定値、すなわち判定前値 `+ 1` とする。拒否時は `lastSeenMs=effectiveNow` のみ更新し、返却する `estimatedCount` は判定前値とする。結果の `estimatedCount` は内部の重み付き実数であり、整数への切上げ・切捨てをしない。

## 5. retryAfterMs の導出

許可時は `retryAfterMs=0`。拒否時の値は、以後に同じキーの許可要求が介在しないと仮定したとき、次の `check` が許可される最小の整数ミリ秒待機時間である。

`currentCount < limit` なら、現在窓内で許可に必要な条件は以下である。

```text
currentCount + previousCount * (windowMs - (elapsedMs + d)) / windowMs + 1 <= limit
d >= windowMs * (currentCount + previousCount + 1 - limit) / previousCount - elapsedMs
```

ここで `d` は整数ミリ秒であり、拒否かつ `currentCount < limit` なら `previousCount > 0` が成立する。最小の整数待機時間を、丸め誤差を避けて次で求める。

```text
need = windowMs * (currentCount + previousCount + 1 - limit) - previousCount * elapsedMs
retryAfterMs = max(1, ceil(need / previousCount))
```

`need` と各積が安全整数でなければ `RangeError` とする。上式の分岐では現在窓の解を選ぶので、`1 <= retryAfterMs <= remainingMs <= windowMs` が保証される。

`currentCount >= limit` なら現在窓内に解はない。次窓開始まで `remainingMs` 待つと状態は `previousCount=currentCount, currentCount=0` に移る。次窓でさらに `x` ms 後に許可される条件は `currentCount * (windowMs-x) / windowMs + 1 <= limit` であるため、次を用いる。

```text
x = ceil(windowMs * (currentCount + 1 - limit) / currentCount)
retryAfterMs = remainingMs + x
```

この分岐では `1 <= x <= windowMs` であり、厳密な範囲は `remainingMs + 1 <= retryAfterMs <= 2 * windowMs - elapsedMs` となる。和 `2 * windowMs - elapsedMs` が安全整数でない場合は `RangeError` とする。したがって拒否時の全体範囲は `1 <= retryAfterMs <= 2 * windowMs - elapsedMs` である。待機後の時刻で同じキーを再判定すると、式の不等式を満たして許可される（ただし別の許可要求が介在しないこと）。時計後退は単調丸めされるため、実時間を待っても時計が進まなければ待機は消費されない。

## 6. 数式・状態遷移の検算

以下では `L=limit`、`W=windowMs` とする。いずれも比較に丸めを入れない。

1. 境界ケース A: `L=10, W=1000, previousCount=10, currentCount=0, elapsedMs=0`。推定は `0+10*1000/1000=10`、次要求は `11<=10` で拒否。`currentCount<L` なので `need=1000*(0+10+1-10)-10*0=1000`、待機は `ceil(1000/10)=100` ms。100 ms 後は推定 `10*900/1000=9`、要求後 `10<=10` で許可する。
2. 境界ケース B: 同じ状態で `elapsedMs=999`。推定は `10/1000=0.01`、要求後 `1.01<=10` で許可する。窓終端直前の前窓寄与を保持しつつ許可されることを確認できる。
3. 待機の別ケース: `L=5, W=1000, previousCount=5, currentCount=2, elapsedMs=400`。推定は `2+5*600/1000=5` で拒否。`need=1000*(2+5+1-5)-5*400=1000`、待機 `ceil(1000/5)=200` ms。600 ms 時点の推定は `2+5*400/1000=4`、要求後 5 で許可。199 ms 後は推定 4.005、要求後 5.005 で依然拒否。
4. 現在窓飽和: `L=5, W=1000, previousCount=0, currentCount=5, elapsedMs=300`。推定 5 で拒否する。`remainingMs=700`、次窓内の `x=ceil(1000*(5+1-5)/5)=200`、従って待機は 900 ms。700 ms 後は状態 `(previousCount,currentCount)=(5,0)`、推定 5 でなお拒否し、900 ms 後は推定 4、要求後 5 で許可する。導出値が実際に許可となる時刻へ往復することを確認できる。
5. 前窓遷移: `W=1000`、時刻 1200 の状態が `windowStartMs=1000, previousCount=3, currentCount=4` である。時刻 2000 では 1 窓遷移し `(2000,4,0)`、時刻 4000 では 2 窓遷移し `(4000,0,0)` となる。前窓の寄与が 2 窓後に残らない。

注: `retryAfterMs` は同一キーの状態を変える別の許可要求が介在しない場合の最短許可時刻である。並行的に同じキーを利用する呼出し側は、待機後も必ず `check` を再実行する。

## 7. 失敗モードと対応

|ID|失敗または異常|検出・対応|状態への影響|
|---|---|---|---|
|FM-01|不正な `limit` / `windowMs` / `idleTtlMs`|コンストラクターで `RangeError`|インスタンスを生成しない|
|FM-02|不正な `now` / key|`TypeError`|変更なし|
|FM-03|時計関数の例外|その例外を同一オブジェクトのまま送出|対象キーおよび全 Map とも変更なし|
|FM-04|時計が非整数、非有限、安全整数外、窓計算不能|`RangeError`|変更なし|
|FM-05|時計後退|キーごとの最終時刻へ丸める|安全側に保持|
|FM-06|2 窓以上の巨大ジャンプ|両カウンターを 0 にして新窓へ移動|古い使用量を破棄|
|FM-07|カウンター加算・積・差・待機時間和の安全整数オーバーフロー|`RangeError`|変更なし|
|FM-08|拒否された要求|`allowed=false` と待機値を返す|カウンターは不変、最終観測時刻のみ更新|
|FM-09|メモリー増加|`idleTtlMs>0` で呼出し側が `prune()`|対象キーを削除|

## 8. 受入テスト

1. `limit=2, windowMs=1000` で同一時刻に 2 回許可、3 回目を拒否し、各結果の `allowed`、`estimatedCount`、`retryAfterMs` を確認する。
2. 直前窓で 10 回許可した状態を注入時計で作り、次窓の 0 ms、999 ms で第 6 節のケース A/B と同じ判定値になることを確認する。
3. 第 6 節ケース 3 で 199 ms は拒否、200 ms は許可であること、返された待機値が 200 であることを確認する。
4. 第 6 節ケース 4 で待機値が 900、700 ms 後はなお拒否、900 ms 後は許可であることを確認する。
5. 1 窓遷移で `previousCount` が旧 `currentCount` に移り、2 窓遷移で両方 0 になることを `estimatedCount` と許可結果で確認する。
6. 時計を進めた後に過去値へ戻し、過去値の `check` が使用量を失効させず、進めた時刻と同じ結果になることを確認する。
7. 非安全整数の時刻、`NaN`、`Infinity`、0 以下の `limit/windowMs`、負の `idleTtlMs`、非文字列 key が指定例外となり、直前のキー状態が変わらないことを確認する。
8. `idleTtlMs=100` のキーを 100 ms 以上非活動にして `prune()` が 1 を返すこと、`idleTtlMs=0` では削除しないことを確認する。
9. `limit=floor(Number.MAX_SAFE_INTEGER/2)+1` が `RangeError` となること、および内部テスト用に最大許可カウントと大きな窓幅を構成した積・和の安全整数オーバーフローが `RangeError` かつカウンター不変となることを確認する。
10. `reset(key)` が対象だけを、`reset()` が全キーを消すことを確認し、消去後の次 `check` が新規キーとして扱われることを確認する。
11. **FM-03 時計例外の伝播と原子性**: 実装単体テストでは、次のコードを実行する。`buckets` は第 3 節のキー別 `Map<string, Bucket>` の実装内フィールドであり、ここではテストからのみ構造的スナップショットを取る。`node:assert/strict` の全 assertion が通れば合格、1 個でも失敗または例外オブジェクトが異なれば不合格とする。

```ts
import assert from 'node:assert/strict';
let t = 0;
let fail = false;
const boom = new Error('clock failed');
const limiter = new RateLimiter({ limit: 2, windowMs: 1000, now: () => {
  if (fail) throw boom;
  return t;
}});
const internal = limiter as unknown as { buckets: Map<string, Bucket> };
const snapshot = () => [...internal.buckets].map(([k, b]) => [k, { ...b }]);

assert.equal(limiter.check('target').allowed, true); // target.currentCount=1
assert.equal(limiter.check('other').allowed, true);  // Map に別キーも作る
const targetBefore = { ...internal.buckets.get('target')! };
const mapBefore = snapshot();
fail = true;
assert.throws(() => limiter.check('target'), error => error === boom);
assert.deepEqual(internal.buckets.get('target'), targetBefore);
assert.deepEqual(snapshot(), mapBefore);
fail = false;
assert.deepEqual(limiter.check('target'), {
  allowed: true, estimatedCount: 2, retryAfterMs: 0,
});
```

このテストは、時計が投げた `boom` が同一参照で伝播し、例外呼出しの前後で対象キーと全 Map が不変であり、次の正常時計呼出しが `target.currentCount=1` の事前状態から 2 回目として継続することを同時に判定する。

## 9. Node.js 数値往復検証

第 6 節のケース A/B、ケース 3、ケース 4 と前窓から現窓への 1 窓・2 窓遷移を、以下のスクリプトで再現する。実装の私有状態を参照せず、仕様にある式と遷移規則だけを実行する検証である。`swc-verify.js` として保存し、Node.js の組込み `assert` のみで実行する。

```js
'use strict';
const assert = require('node:assert/strict');
const W = 1000;
const estimate = (p, c, e) => c + p * (W - e) / W;
const allowed = (p, c, e, L) => estimate(p, c, e) + 1 <= L;
const retry = (p, c, e, L) => c < L
  ? Math.max(1, Math.ceil((W * (c + p + 1 - L) - p * e) / p))
  : W - e + Math.ceil(W * (c + 1 - L) / c);
const slide = (b, now) => {
  const start = Math.floor(now / W) * W;
  const jumps = (start - b.start) / W;
  return jumps === 0 ? b : jumps === 1
    ? { start, p: b.c, c: 0 } : { start, p: 0, c: 0 };
};

// ケース A: 境界 e=0、wait=100 の往復。
assert.equal(estimate(10, 0, 0), 10);
assert.equal(allowed(10, 0, 0, 10), false);
assert.equal(retry(10, 0, 0, 10), 100);
assert.equal(allowed(10, 0, 100, 10), true);
// ケース B: 境界 e=W-1。
assert.equal(estimate(10, 0, 999), 0.01);
assert.equal(allowed(10, 0, 999, 10), true);
// ケース 3: retry の直前/直後。
assert.equal(retry(5, 2, 400, 5), 200);
assert.equal(allowed(5, 2, 599, 5), false);
assert.equal(allowed(5, 2, 600, 5), true);
// ケース 4: 現窓飽和、次窓へのスライド後の retry 往復。
assert.equal(retry(0, 5, 300, 5), 900);
assert.deepEqual(slide({ start: 0, p: 0, c: 5 }, 1000), { start: 1000, p: 5, c: 0 });
assert.equal(allowed(5, 0, 0, 5), false);
assert.equal(allowed(5, 0, 200, 5), true);
// 1 窓と 2 窓の遷移。
assert.deepEqual(slide({ start: 1000, p: 3, c: 4 }, 2000), { start: 2000, p: 4, c: 0 });
assert.deepEqual(slide({ start: 2000, p: 4, c: 0 }, 4000), { start: 4000, p: 0, c: 0 });
console.log('SWC numeric round-trip: 4 cases, 1-window and 2-window transitions: OK');
```

実行コマンドと期待ログは次のとおりである。

```text
node swc-verify.js
SWC numeric round-trip: 4 cases, 1-window and 2-window transitions: OK
exit code: 0
```

## 10. 仕様境界の機械検査

この文書を `spec_strict_goal.md` として保存した状態で、次のコマンドは禁止された節見出しがなく、範囲外リストが末尾の 1 行だけであることを検査する。成功時の終了コードは 0 である。

```text
node -e "const fs=require('node:fs');const s=fs.readFileSync('spec_strict_goal.md','utf8');const a=s.trimEnd().split(/\\r?\\n/);if(/^#{1,6} .*?(配布物|CI|運用手順)/m.test(s)||a.filter(x=>x.startsWith('範囲外:')).length!==1||!a.at(-1).startsWith('範囲外:'))process.exit(1)"
```

## 11. 堅牢化とトレードオフ

SWC は要求時刻を全件保存する厳密な sliding log より定数メモリーで高速だが、窓内の要求分布を一様と仮定する近似であり、厳密な移動窓上限を保証しない。キーごとの状態量は定数、同期 `check`、`reset(key)`、および `prune` の各キー判定は O(1)、同期 `reset()` と `prune()` 全体は保持キー数 N に対し O(N) である。`idleTtlMs=0` は自動メモリー解放をしないため、キー空間が無限の用途では正の TTL と定期的な `prune()` を選ぶ。時計後退を丸める方針は安全側だが、システム時計が停止・後退した環境では解除が遅れる。単一プロセスで同期実行する前提により、同一イベントループ上の `check` 間に競合はない。

第 7 節の各行と 1 対 1 に対応する防御判断を次に固定する。「採用判断」は API がその事象に対して行う動作を `拒否`、`警告`、`記録` のいずれか 1 つで示す。本仕様は外部ログを持たないため、`警告` を採用する行はなく、記録は `Bucket` 状態への保持を意味する。

|第 7 節の失敗モード|防御機構|正当だが失敗・不利益になるケース|代替案|採用判断|採用理由と限界|
|---|---|---|---|---|---|
|不正な `limit` / `windowMs` / `idleTtlMs`|安全整数・範囲検証と `limit` 上限|非常に大きいが意図的な上限値を指定しても生成に失敗する。|`BigInt` 演算、または値の飽和。|拒否|丸めた上限で許可するより安全である。`BigInt` は API の実数推定・性能を変えるため採用しない。|
|不正な `now` / key|関数・文字列の型検証|`String` オブジェクトや callable でない時計値を利用したい呼出しも失敗する。|文字列への強制変換、固定時計へのフォールバック。|拒否|キー衝突と無自覚な時刻固定を避ける。呼出し側の型誤り自体は防げない。|
|時計関数の例外|時計例外をそのまま伝播|一時的に時計供給が失敗した正当な要求も失敗する。|直前時刻を再利用、例外を握り潰して許可。|拒否|原因を隠して利用量を誤計上しない。時計供給の復旧はこのクラスでは保証できない。|
|時計が非整数、非有限、安全整数外、窓計算不能|時刻・窓演算の事前検証|正当な遠未来時刻や広い窓幅でも範囲外なら失敗する。|浮動小数で継続、時刻を丸める。|拒否|境界での誤許可を避ける。安全整数を超える時間軸は表現できない。|
|時計後退|`lastSeenMs` への単調丸め|正当な手動時刻補正後も解除が遅れる。|後退時にカウンターを消去、単調時計を必須化。|記録|最終観測時刻を記録して利用量を失効させない。停止した時計を進めることはできない。|
|2 窓以上の巨大ジャンプ|両カウンターを 0 にして新窓へ遷移|長時間休止後のキーは過去利用量を失い、直後に再利用できる。|全窓履歴を保存、古い値を減衰保持。|記録|SWC の直前窓だけという状態を記録し直す。過去窓内の正確な要求分布は復元不能である。|
|カウンター加算・積・差・待機時間和の安全整数オーバーフロー|各整数演算前の安全性検査|高頻度で大きな窓を用いる正当な設定・状態でも要求が失敗する。|`BigInt`、浮動小数の丸め、飽和カウンター。|拒否|精度喪失による誤許可を防ぐ。許容可能な最大負荷を自動拡張しない。|
|拒否された要求|判定後にカウンターを増やさず `retryAfterMs` を返す|正当なバースト要求が拒否され、同時呼出しでは待機後にも再拒否され得る。|待機キュー、予約トークン、超過を許可して後払い。|拒否|同期・定数状態を維持し、超過を通さない。別要求の介在による再拒否は防げない。|
|メモリー増加|`lastSeenMs` 記録と任意 TTL の `prune()`|TTL を有効にすると、正当な休眠キーの状態が消えて次回は新規扱いになる。|無期限保持、容量上限付き LRU、自動タイマー削除。|記録|既定値 0 では状態保持を優先し、TTL 選択時だけ活動時刻を記録して明示 `prune()` で削除する。無限キー空間のメモリー枯渇は完全には防げない。|

限界: SWC の近似誤差、単一プロセス外での共有不能、同一キーの呼出し間の公平な順序付け、無限キー空間の完全なメモリー保護は、この防御群では防げない。

範囲外: 分散共有、永続化、HTTP ミドルウェア、非同期キュー、利用者識別方式、監視・配布・CI・運用手順。
