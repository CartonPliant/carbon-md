import test from "node:test";
import assert from "node:assert/strict";

import { classify, estimateGco2e, CLASS_FACTORS, INPUT_TOKEN_WEIGHT, FACTORS_VERSION } from "../core/factors.js";

test("factors version is stamped 2026-08", () => {
  assert.equal(FACTORS_VERSION, "carbonmd-factors-2026-08");
});

test("2026-10-11 steer preserves every emission band and input weight", () => {
  assert.deepEqual(CLASS_FACTORS, {
    frontier: { low: 1.5, central: 4.5, high: 15 },
    large: { low: 0.8, central: 2.5, high: 8 },
    medium: { low: 0.2, central: 0.8, high: 2.5 },
    small: { low: 0.03, central: 0.15, high: 0.6 },
  });
  assert.equal(INPUT_TOKEN_WEIGHT, 0.2);
});

test("2026-10-04 releases, usage aliases and catch-up IDs", () => {
  const examples = {
    frontier: ["gpt-6-sol", "openai/gpt-6-sol", "gpt-6.1-sol", "openai/gpt-6.1-sol",
      "claude-opus-5-5", "claude-opus-5-5[1m]", "anthropic/claude-opus-5.5",
      "Gemini 4 Argon", "google/gemini-4-argon"],
    large: ["claude-sonnet-5-5", "anthropic/claude-sonnet-5.5", "grok-4.7",
      "mimo-v2.6-pro", "XiaomiMiMo/MiMo-V2.6-Pro-RL", "mimo-v2.6-pro-ultraspeed"],
    small: ["gpt-6-luna", "openai/gpt-6-luna", "mimo-v2.6-flash",
      "XiaomiMiMo/MiMo-V2.6-Flash-RL", "IndexTeam/Index-Translate-2B",
      "IndexTeam/Index-Translate-9B", "IndexTeam/Index-Translate-35B-A3B-preview",
      "IndexTeam/Index-Translate-35B-A3B-preview-FP8"],
  } as const;
  for (const [cls, models] of Object.entries(examples)) {
    for (const model of models) assert.deepEqual(classify(model), { cls, guessed: false }, model);
  }
  // A routed backend cannot be inferred from a price or a benchmark score.
  assert.deepEqual(classify("pareto"), { cls: "medium", guessed: true });
  assert.deepEqual(classify("gemini-4-argon-mini"), { cls: "small", guessed: false });
  // Do not extrapolate the 3B-active exception to unknown future Index sizes.
  assert.deepEqual(classify("index-translate-70b"), { cls: "medium", guessed: true });
});

test("2026-10-11 releases, provider IDs and catch-up", () => {
  for (const model of ["Beam", "Reflection Beam", "reflection/beam", "reflection-ai/beam",
    "MiniMax-M3", "minimax/minimax-m3", "MiniMaxAI/MiniMax-M3",
    "mistralai/mistral-large-4-0", "mistral-large-4", "stepfun/step-5-preview"]) {
    assert.deepEqual(classify(model), { cls: "large", guessed: false }, model);
  }
  for (const model of ["claude-haiku-5-5", "anthropic/claude-haiku-5.5",
    "glm-5.3-fast", "inclusionai/ling-3.1-flash"]) {
    assert.deepEqual(classify(model), { cls: "small", guessed: false }, model);
  }
  // Fast is a naming heuristic, not a measured saving or a new factor band.
  assert.deepEqual(classify("glm-5.3"), { cls: "large", guessed: false });
  assert.deepEqual(classify("reflection/beam-mini"), { cls: "small", guessed: false });
  assert.deepEqual(classify("MiniMax-M3-flash"), { cls: "small", guessed: false });
  for (const model of ["beam-search", "other/beam", "MiniMax-M4", "MiniMax-H3", "reka-edge-2603"]) {
    assert.deepEqual(classify(model), { cls: "medium", guessed: true }, model);
  }
});

test("frontier flagships", () => {
  for (const m of [
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.5",
    "gpt-5.6-sol",
    "o3",
    "o4",
    "claude-opus-5",
    "claude-fable-5",
    "claude-fable-5.1",
    "claude-mythos-1",
    "claude-mythos-5.1",
    "gemini-3.1-pro-preview",
    "gpt-6-astra",
    "openai/gpt-6-astra",
    "openai/gpt-6-astra-pro",
  ]) {
    const r = classify(m);
    assert.equal(r.cls, "frontier", `${m} should be frontier`);
    assert.equal(r.guessed, false, `${m} should not be guessed`);
  }
});

test("gpt-5.4 full tier is frontier, mini is small", () => {
  assert.equal(classify("gpt-5.4").cls, "frontier");
  assert.equal(classify("gpt-5.4-mini").cls, "small");
});

test("gpt-6-astra is frontier; hypothetical gpt-6-mini stays small", () => {
  assert.equal(classify("gpt-6-astra").cls, "frontier");
  assert.equal(classify("gpt-6-astra-pro").cls, "frontier");
  assert.equal(classify("gpt-6-mini").cls, "small");
});

test("hy4-preview is large; hy-mt translation family stays small", () => {
  assert.equal(classify("tencent/hy4-preview").cls, "large");
  assert.equal(classify("tencent/hy-mt2-7b").cls, "small");
});


test("small tiers", () => {
  for (const m of [
    "gpt-5.6-luna",
    "gpt-5-luna",
    "gpt-5.4-mini",
    "gpt-5-nano",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-lite-preview",
    "deepseek-v4-flash",
    "claude-haiku-4",
    "gemma-4-9b",
    "phi-5-mini",
    "nvidia/nemotron-3.5-lightning",
    "liquid/lfm-2.5-2.6b",
    "stepfun/step-3.7-flash",
    "deepseek/deepseek-v4-flash-vision-exp",
    "tencent/hy-mt2-1.8b",
    "tencent/hy-mt2-7b",
    "tencent/hy-mt2-30b-a3b",
    "z-ai/glm-5.3-flash",
    "glm-5.3-flash",
    "qwen/qwen3.8-flash-next",
    "qwen/qwen3.8-flash",
    "stealth/ox-alpha",
    "gemini-3.8-flash",
    "google/gemini-3.8-flash",
    "gemini-3.8-flash-cyber",
    "inception/mercury-2.5-preview",
    "ibm-granite/granite-4.2-8b",
    "deepseek/deepseek-v4.1-flash",
    "deepseek-v4.1-flash",
    "deepseek-flash",
    "inclusionai/ling-3.0-flash-fin",
  ]) {
    const r = classify(m);
    assert.equal(r.cls, "small", `${m} should be small`);
    assert.equal(r.guessed, false, `${m} should not be guessed`);
  }
});

test("grok-composer-2.5-fast is small (2026-08 steer decision)", () => {
  // Deliberate: composer+fast cheap tier overrides the has("grok") -> large
  // rule. Documented in docs-site/content/models.md.
  const r = classify("grok-composer-2.5-fast");
  assert.equal(r.cls, "small");
  assert.equal(r.guessed, false);
});

test("large workhorses", () => {
  for (const m of [
    "gpt-5.6-terra",
    "gpt-4o",
    "claude-sonnet-5",
    "grok-4.3",
    "grok-4.6",
    "grok-build-0.1",
    "grok-4",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k2.8-preview",
    "kimi-k3",
    "kimi-for-coding",
    "deepseek-v4-pro",
    "deepseek/deepseek-v4-pro",
    "qwen/qwen3.7-max",
    "qwen/qwen3.8-max",
    "qwen/qwen3.8-2.4t-a95b",
    "qwen/qwen3.8-27b",
    "deepseek/deepseek-v4-pro-0813",
    "bytedance-seed/seed-2-1-turbo",
    "bytedance-seed/seed-2.0-code",
    "sakana/sakana-namazu",
    "qwen3-max",
    "z-ai/glm-5.2",
    "z-ai/glm-5.3",
    "glm-5",
    "meta/muse-spark-1.2-contributor",
    "meta/muse-spark-1.3",
    "meta/muse-spark-1.3-contributor",
    "qwen/qwen3.8-max-0902",
    "tencent/hy4-preview",
    "meituan/longcat-2.0:free",
    "meituan-longcat/LongCat-2.0",
    "mistral-large-3",
    "command-a",
    "llama-3.1-405b",
    "deepseek-r1",
    "upstage/solar-pro4:free",
    "Atria-Dawn-Preview",
  ]) {
    const r = classify(m);
    assert.equal(r.cls, "large", `${m} should be large`);
    assert.equal(r.guessed, false, `${m} should not be guessed`);
  }
});

test("unknown models fall to medium + guessed", () => {
  const r = classify("some-random-model-9000");
  assert.equal(r.cls, "medium");
  assert.equal(r.guessed, true);
});

test("ox-alpha is small (unmasked 2026-08-26 as GLM-5.3-Flash)", () => {
  const ox = classify("stealth/ox-alpha");
  assert.equal(ox.cls, "small");
  assert.equal(ox.guessed, false);
});

test("small params markers (1b..14b) win first", () => {
  // smallB is checked in the small block, before family rules like qwen.
  assert.equal(classify("qwen3-8b").cls, "small");
  assert.equal(classify("llama-3.2-3b").cls, "small");
  assert.equal(classify("liquid/lfm-2.5-2.6b").cls, "small");
  assert.equal(classify("some-70b-model").cls, "medium"); // 70b is out of the small band
  assert.equal(classify("bytedance-seed/seed-2.0-lite").cls, "small");
  assert.equal(classify("bytedance-seed/seed-2.0-mini").cls, "small");
});

test("estimate factors follow the class", () => {
  const small = estimateGco2e("gpt-5.6-luna", 0, 1000);
  const frontier = estimateGco2e("gpt-5.6-sol", 0, 1000);
  assert.ok(small.central < frontier.central);
  assert.equal(small.cls, "small");
  assert.equal(frontier.cls, "frontier");
});
