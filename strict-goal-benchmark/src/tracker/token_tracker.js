export const DEFAULT_PRICING = {
  prompt_per_million: 3.0,
  completion_per_million: 15.0,
  cached_per_million: 0.75,
};

export class TokenTracker {
  constructor(pricing = DEFAULT_PRICING) {
    this.pricing = { ...DEFAULT_PRICING, ...pricing };
    this.turns = [];
    this.prompt_tokens = 0;
    this.completion_tokens = 0;
    this.cached_tokens = 0;
    this.total_tokens = 0;
  }

  recordTurn({ prompt_tokens = 0, completion_tokens = 0, cached_tokens = 0 }) {
    const turnData = {
      turn: this.turns.length + 1,
      prompt_tokens: Math.max(0, prompt_tokens),
      completion_tokens: Math.max(0, completion_tokens),
      cached_tokens: Math.max(0, cached_tokens),
      timestamp: new Date().toISOString(),
    };

    this.prompt_tokens += turnData.prompt_tokens;
    this.completion_tokens += turnData.completion_tokens;
    this.cached_tokens += turnData.cached_tokens;
    this.total_tokens = this.prompt_tokens + this.completion_tokens;

    this.turns.push(turnData);
    return turnData;
  }

  getCostUSD() {
    const promptCost = (this.prompt_tokens / 1_000_000) * this.pricing.prompt_per_million;
    const completionCost = (this.completion_tokens / 1_000_000) * this.pricing.completion_per_million;
    const cachedCost = (this.cached_tokens / 1_000_000) * this.pricing.cached_per_million;
    const rawCost = promptCost + completionCost + cachedCost;
    return Math.round(rawCost * 1000) / 1000;
  }

  getSummary() {
    return {
      prompt_tokens: this.prompt_tokens,
      completion_tokens: this.completion_tokens,
      cached_tokens: this.cached_tokens,
      total_tokens: this.total_tokens,
      estimated_cost_usd: this.getCostUSD(),
      turns_count: this.turns.length,
    };
  }

  reset() {
    this.turns = [];
    this.prompt_tokens = 0;
    this.completion_tokens = 0;
    this.cached_tokens = 0;
    this.total_tokens = 0;
  }
}
