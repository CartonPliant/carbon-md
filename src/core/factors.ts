/**
 * carbonmd-factors-2026-08
 *
 * Per-model-class emission factors, gCO2e per 1k OUTPUT tokens.
 * Input tokens are weighted at 0.2x of the output-token factor.
 *
 * Derivation: EcoLogits methodology (JOSS 2025) regression curves +
 * public provider disclosures (Google 2025 median-prompt figure,
 * OpenAI per-query statements), converted with a world-average grid
 * intensity assumption (~400 gCO2e/kWh) and rounded to one significant
 * figure of honesty. Ranges are wide BY DESIGN: cloud inference is a
 * black box. Estimates are only comparable within a factors version.
 *
 * Classification catalog refreshed 2026-10-11 against live agent usage
 * (Hermes) + public model releases / limited previews through 2026-10-11.
 * Factor *bands* unchanged — new IDs only; still carbonmd-factors-2026-08.
 */

export const FACTORS_VERSION = "carbonmd-factors-2026-08";

export type ModelClass = "frontier" | "large" | "medium" | "small";

export interface Range {
  low: number;
  central: number;
  high: number;
}

/** gCO2e per 1k output tokens */
export const CLASS_FACTORS: Record<ModelClass, Range> = {
  frontier: { low: 1.5, central: 4.5, high: 15 },
  large: { low: 0.8, central: 2.5, high: 8 },
  medium: { low: 0.2, central: 0.8, high: 2.5 },
  small: { low: 0.03, central: 0.15, high: 0.6 },
};

export const INPUT_TOKEN_WEIGHT = 0.2;

/**
 * Whole-token small markers. Checked before frontier so
 * `gpt-5.4-mini`, `gemini-3.6-flash`, `deepseek-v4-flash` land small.
 */
const SMALL_TOKENS = new Set([
  "haiku",
  "mini",
  "flash",
  "nano",
  "tiny",
  "lite",
  "micro",
  "gemma",
  "phi",
  "luna", // GPT-5.6 Luna — cheap/small tier
  "fast", // cheap/fast tiers (composer-fast, *-fast)
  "lightning", // NVIDIA Nemotron Lightning etc.
  "mercury", // Inception Mercury 2.5 — diffusion LLM, Luna/Haiku class
]);

function tokenize(model: string): string[] {
  return model
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);
}

/**
 * Heuristic model -> class mapping. Checked in order:
 * small markers first (so "gpt-5-mini" / "gpt-5.6-luna" land small),
 * then frontier flagships, then known large families, and finally
 * medium + guessed for anything unknown.
 */
export function classify(model: string): { cls: ModelClass; guessed: boolean } {
  const raw = model.toLowerCase();
  const tokens = tokenize(model);
  const has = (t: string) => tokens.includes(t);
  const smallB = tokens.some((t) => /^([1-9]|1[0-4])(\.\d+)?b$/.test(t)); // 1b..14b, also 2.6b

  // --- small / cheap tiers ---
  // grok-composer-2.5-fast: fast/composer tier treated as small on purpose
  // (2026-08 steer, documented in docs-site/content/models.md).
  if (
    tokens.some((t) => SMALL_TOKENS.has(t)) ||
    smallB ||
    (raw.includes("composer") && raw.includes("fast")) ||
    raw.includes("hy-mt") || // Tencent Hy-MT2 translation family (2026-08-23)
    raw.includes("hunyuan-mt") ||
    raw.includes("ox-alpha") || // unmasked 2026-08-26 as GLM-5.3-Flash
    raw.includes("oxalpha") ||
    raw.includes("mercury") || // Inception Mercury 2.5 — cheap/fast diffusion LLM
    /(?:^|\/)index-translate-35b-a3b-preview(?:$|-)/.test(raw) // 3B-active translation MoE
  ) {
    return { cls: "small", guessed: false };
  }

  // --- frontier flagships ---
  // Anthropic / Google / generic ultra-heavy markers
  if (has("opus") || has("fable") || has("mythos") || has("ultra") || has("heavy")) {
    return { cls: "frontier", guessed: false };
  }
  // OpenAI: gpt-5.x full tiers (mini/nano/luna already small; terra is large, see below)
  if (
    has("sol") || // GPT-5.6 Sol — frontier reasoning tier
    has("o3") ||
    has("o4") ||
    raw.includes("gpt-5.5") ||
    raw.includes("gpt-5.6-sol") ||
    raw.includes("gpt-6") || // GPT-6 Astra / Astra Pro (2026-09-03)
    (raw.includes("gpt-5") &&
      !raw.includes("mini") &&
      !raw.includes("nano") &&
      !raw.includes("luna") &&
      !raw.includes("terra"))
  ) {
    return { cls: "frontier", guessed: false };
  }
  // Explicit frontier families
  if (
    raw.includes("claude-opus") ||
    raw.includes("claude-fable") ||
    raw.includes("gpt-6") ||
    (has("gemini") && (has("argon") || raw.includes("3.1-pro") || raw.includes("3-pro")))
  ) {
    return { cls: "frontier", guessed: false };
  }

  // --- large ---
  if (
    has("sonnet") ||
    has("terra") || // GPT-5.6 Terra — mid-high tier, classified large
    raw.includes("gpt-4") ||
    (has("gemini") && has("pro")) ||
    has("grok") ||
    raw.includes("r1") ||
    (has("mistral") && has("large")) ||
    has("405b") ||
    has("command") ||
    raw.includes("kimi") ||
    raw.includes("deepseek") ||
    has("k2") ||
    has("k3") ||
    raw.includes("qwen") ||
    has("glm") ||
    raw.includes("glm-") ||
    has("muse") ||
    has("seedream") ||
    has("seed") || // ByteDance Seed 2.x workhorses (lite/mini already small)
    has("sakana") ||
    has("namazu") || // Sakana Namazu — Kimi K2.6 derivative
    tokens.some((t) => t.startsWith("step")) ||
    raw.includes("v4-pro") ||
    raw.includes("codex") ||
    has("hy4") || // Tencent Hunyuan 4 flagship (not hy-mt translation)
    raw.includes("hy4-") ||
    has("longcat") || // Meituan LongCat-2.0 — 1.6T MoE coding workhorse
    raw.includes("longcat") ||
    raw.includes("solar-pro") || // Upstage Solar Pro 4 — agentic workhorse
    has("atria") || // Shanghai AI Lab Atria Dawn Preview — 744B agentic MoE
    /^(?:reflection(?:[ .-]ai)?[\/ -])?beam$/.test(raw) || // Reflection Beam preview, 501B/23B active; not an API-ID claim
    ((has("minimax") || has("minimaxai")) && has("m3")) || // MiniMax M3 coding/agent workhorse; not all MiniMax modalities
    (has("mimo") && has("pro")) // MiMo-V2.6-Pro / Pro-RL / Pro-UltraSpeed (42B active)
  ) {
    return { cls: "large", guessed: false };
  }

  return { cls: "medium", guessed: true };
}

export interface Estimate extends Range {
  cls: ModelClass;
  guessed: boolean;
}

/** Estimate gCO2e for a single call. */
export function estimateGco2e(model: string, tokensIn: number, tokensOut: number): Estimate {
  const { cls, guessed } = classify(model);
  const f = CLASS_FACTORS[cls];
  const weightedKtok = (tokensOut + INPUT_TOKEN_WEIGHT * tokensIn) / 1000;
  return {
    low: f.low * weightedKtok,
    central: f.central * weightedKtok,
    high: f.high * weightedKtok,
    cls,
    guessed,
  };
}

export const PRICES_VERSION = "carbonmd-prices-2026-07";

/**
 * Default price assumptions per portfolio, USD per tCO2e.
 *
 * PLANNING FIGURES, NOT QUOTES. The spread on removal is genuinely enormous, so
 * a narrow range here would be a lie in both directions. Anchors observed live
 * on the Klima x402 rail, July 2026:
 *
 *   nature-based removal (Regen City Forest)   ~$17/t
 *   durable, biochar (Puro)                    ~$127/t   — whole tonnes only
 *   durable, ocean alkalinity enhancement      ~$1,308/t — cheapest durable
 *                                                          removal buyable
 *                                                          fractionally today
 *
 * "removal-weighted" centres on durable biochar because that is what the
 * portfolio name promises; the high end is OAE, which is what a small agent
 * footprint actually ends up buying, since sub-tonne durable removal has no
 * cheaper option yet. `contribute --execute` never uses these numbers — it
 * prices against a live quote and refuses to spend past the policy caps.
 */
export const PORTFOLIO_PRICES: Record<string, Range | null> = {
  // Same band as removal-weighted — both buy removal; only the enforcement
  // differs. The low end is the cheapest removal actually on the rail.
  "removal-only": { low: 12, central: 130, high: 1400 },
  "removal-weighted": { low: 20, central: 130, high: 1400 },
  balanced: { low: 8, central: 30, high: 200 },
  custom: null,
};

export function formatG(g: number): string {
  if (g >= 1_000_000) return `${(g / 1_000_000).toFixed(2)} tCO2e`;
  if (g >= 1000) return `${(g / 1000).toFixed(2)} kgCO2e`;
  return `${g.toFixed(g < 1 ? 3 : 1)} gCO2e`;
}
