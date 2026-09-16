/**
 * Fixed Calibration Battery containing 10 deterministic anchor prompts
 * to detect silent model updates, prompt drift, and token distribution shifts.
 */
export const CALIBRATION_BATTERY = [
  { id: 'cal_01', prompt: 'Return exactly the string "OK" with no extra characters.' },
  { id: 'cal_02', prompt: 'Compute 2 + 2 and output only the number.' },
  { id: 'cal_03', prompt: 'Reverse the word "antigravity" and return only the reversed word.' },
  { id: 'cal_04', prompt: 'Output the first three prime numbers separated by a single space.' },
  { id: 'cal_05', prompt: 'Sort [4, 1, 3, 2] in ascending order as JSON array.' },
  { id: 'cal_06', prompt: 'What is the capital of France? Return only the city name.' },
  { id: 'cal_07', prompt: 'What is the SHA-256 hex digest length? Output only the number.' },
  { id: 'cal_08', prompt: 'Output the markdown bold syntax for the word "bold".' },
  { id: 'cal_09', prompt: 'Translate "hello" to Japanese using Hiragana only.' },
  { id: 'cal_10', prompt: 'Return the JSON string {"status":"healthy"}.' },
];

export class DriftMonitor {
  constructor(baseline = null) {
    this.baseline = baseline || new Map();
  }

  setBaseline(batteryId, expectedTokens, expectedLength) {
    this.baseline.set(batteryId, { expectedTokens, expectedLength });
  }

  evaluateDrift(observations) {
    const drifts = [];
    let totalDivergence = 0;

    for (const obs of observations) {
      const base = this.baseline.get(obs.id);
      if (!base) continue;

      const tokenDiff = Math.abs((obs.token_count || 0) - base.expectedTokens);
      const lengthDiff = Math.abs((obs.output_length || 0) - base.expectedLength);
      const relativeDiff = base.expectedTokens > 0 ? tokenDiff / base.expectedTokens : 0;

      if (relativeDiff > 0.3) {
        drifts.push({
          id: obs.id,
          expectedTokens: base.expectedTokens,
          actualTokens: obs.token_count,
          relativeDivergence: relativeDiff,
        });
      }
      totalDivergence += relativeDiff;
    }

    const meanDivergence = observations.length > 0 ? totalDivergence / observations.length : 0;
    return {
      drift_detected: drifts.length > 2 || meanDivergence > 0.25,
      mean_divergence: Math.round(meanDivergence * 1000) / 1000,
      drifts,
    };
  }
}
