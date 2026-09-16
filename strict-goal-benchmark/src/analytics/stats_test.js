/**
 * Statistical hypothesis testing functions:
 * - Welch's t-test
 * - Cohen's d effect size
 * - Mann-Whitney U test approximation
 * - Bootstrap Confidence Intervals
 */

export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((acc, v) => acc + v, 0) / arr.length;
}

export function variance(arr, m = mean(arr)) {
  if (!arr || arr.length <= 1) return 0;
  const sumSq = arr.reduce((acc, v) => acc + Math.pow(v - m, 2), 0);
  return sumSq / (arr.length - 1);
}

export function cohensD(groupA, groupB) {
  const mA = mean(groupA);
  const mB = mean(groupB);
  const vA = variance(groupA, mA);
  const vB = variance(groupB, mB);
  const nA = groupA.length;
  const nB = groupB.length;

  if (nA + nB <= 2) return 0.0;
  const pooledVar = ((nA - 1) * vA + (nB - 1) * vB) / (nA + nB - 2);
  const pooledSd = Math.sqrt(Math.max(1e-9, pooledVar));
  return Math.round(((mA - mB) / pooledSd) * 100) / 100;
}

export function welchTTest(groupA, groupB) {
  const mA = mean(groupA);
  const mB = mean(groupB);
  const vA = variance(groupA, mA);
  const vB = variance(groupB, mB);
  const nA = Math.max(1, groupA.length);
  const nB = Math.max(1, groupB.length);

  const se = Math.sqrt(vA / nA + vB / nB);
  if (se === 0) {
    return { t_stat: 0, p_value: 1.0, significant: false };
  }

  const tStat = (mA - mB) / se;
  // Welch-Satterthwaite degrees of freedom
  const num = Math.pow(vA / nA + vB / nB, 2);
  const denom = Math.pow(vA / nA, 2) / Math.max(1, nA - 1) + Math.pow(vB / nB, 2) / Math.max(1, nB - 1);
  const df = denom > 0 ? num / denom : 1;

  // Approximate p-value from t-stat (2-tailed standard normal approximation for large or moderate df)
  const z = Math.abs(tStat);
  // Standard normal CDF approximation
  const pValue = Math.min(1.0, Math.max(0.0001, 2 * (1 - normalCdf(z))));

  return {
    t_stat: Math.round(tStat * 100) / 100,
    degrees_of_freedom: Math.round(df * 10) / 10,
    p_value: Math.round(pValue * 10000) / 10000,
    significant: pValue < 0.05,
  };
}

function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function bootstrapCI(arr, alpha = 0.05, samples = 1000) {
  if (!arr || arr.length === 0) return { lower: 0, upper: 0 };
  if (arr.length === 1) return { lower: arr[0], upper: arr[0] };

  const means = [];
  const n = arr.length;
  for (let i = 0; i < samples; i++) {
    let sampleSum = 0;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(Math.random() * n);
      sampleSum += arr[idx];
    }
    means.push(sampleSum / n);
  }

  means.sort((a, b) => a - b);
  const lowIdx = Math.floor((alpha / 2) * samples);
  const highIdx = Math.ceil((1 - alpha / 2) * samples) - 1;

  return {
    lower: Math.round(means[lowIdx] * 1000) / 1000,
    upper: Math.round(means[highIdx] * 1000) / 1000,
  };
}
