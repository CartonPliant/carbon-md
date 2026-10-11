# Model catalog

Living map of **model string → emission class** used by `carbonmd-factors-2026-08`.

This page is steered weekly (Sunday evening, Europe/Zurich): new public releases and models seen in agent usage are classified, documented here, and wired into `src/core/factors.ts`.

**Last steered:** 2026-10-11<br>
**Factors version:** `carbonmd-factors-2026-08`

## How to read this

- Classes feed the gCO₂e bands in [Methodology & factors](/methodology/).
- Matching is **heuristic and honest** — unknown strings fall to `medium` + `guessed: true`.
- Small markers win first (`mini`, `flash`, `luna`, `fast`, `lightning`…), so tiered families classify correctly.

## Frontier

High-capability flagships. Central **4.5 gCO₂e / 1k output tokens**.

| Family | Example IDs |
|---|---|
| OpenAI | `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-6-astra`, `gpt-6-astra-pro`, `gpt-6-sol`, `gpt-6.1-sol`, `o3`, `o4` |
| Anthropic | `claude-opus-5`, `claude-opus-5-5`, `claude-opus-5-5[1m]`, `anthropic/claude-opus-5.5`, `claude-fable-5`, `claude-fable-5.1`, `claude-mythos-5.1`, `*mythos*` |
| Google | `gemini-3.1-pro-preview`, Gemini 4 Argon (limited preview; public API ID not confirmed), `*ultra*` |

## Large

Workhorse coding / agent models. Central **2.5 gCO₂e / 1k output tokens**.

| Family | Example IDs |
|---|---|
| OpenAI | `gpt-5.6-terra`, `gpt-4o`, `*codex*` |
| Anthropic | `claude-sonnet-5`, `claude-sonnet-5-5`, `anthropic/claude-sonnet-5.5`, `*sonnet*` |
| xAI | `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-4.7`, `grok-build-0.1`, `grok-4*` |
| Moonshot | `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k2.8-preview`, `kimi-k3`, `k3`, `kimi-for-coding` |
| DeepSeek | `deepseek-v4-pro`, `deepseek/deepseek-v4-pro`, `deepseek-v4-pro-0813` |
| Meituan | `meituan/longcat-2.0`, `meituan/longcat-2.0:free`, `longcat*` |
| Alibaba | `qwen/qwen3.7-max`, `qwen/qwen3.8-max`, `qwen/qwen3.8-max-0902`, `qwen/qwen3.8-2.4t-a95b`, `qwen/qwen3.8-27b`, `qwen3*` |
| Zhipu | `z-ai/glm-5.2`, `z-ai/glm-5.3`, `glm-5*` (non-flash) |
| ByteDance | `seed-2-1-turbo`, `seed-2.0-code`, `seedream*` |
| Sakana | `sakana-namazu` (Kimi K2.6 derivative) |
| Meta | `muse*`, `muse-spark*`, `muse-spark-1.2-contributor`, `muse-spark-1.3`, `muse-spark-1.3-contributor` |
| Tencent | `hy4-preview` (Hunyuan 4 flagship; not `hy-mt`) |
| Upstage | `upstage/solar-pro4:free`, `solar-pro4` |
| Shanghai AI Lab | `Atria-Dawn-Preview`, `atria-dawn-preview` |
| Xiaomi | `mimo-v2.6-pro`, `XiaomiMiMo/MiMo-V2.6-Pro-RL`, `mimo-v2.6-pro-ultraspeed` |
| Reflection | Beam (early-access product name; public API ID not confirmed) |
| MiniMax | `MiniMax-M3`, `MiniMaxAI/MiniMax-M3` (M3 only; not H3 media generation) |
| Mistral | `mistral-large-4`, `mistralai/mistral-large-4-0` |
| StepFun | `stepfun/step-5-preview` |
| Other | `mistral-large*`, `command*`, `*405b*`, `*r1*` |

## Small

Cheap / fast tiers. Central **0.15 gCO₂e / 1k output tokens**.

| Family | Example IDs |
|---|---|
| OpenAI | `gpt-5.6-luna`, `gpt-6-luna`, `gpt-5.4-mini`, `*-mini`, `*-nano` |
| Anthropic | `claude-haiku-5-5`, `anthropic/claude-haiku-5.5` |
| Google | `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-3.8-flash-cyber`, `*-flash-lite*` |
| DeepSeek | `deepseek-v4-flash`, `deepseek/deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4.1-flash`, `deepseek/deepseek-v4.1-flash`, `deepseek-flash` |
| xAI | `grok-composer-2.5-fast` |
| Alibaba | `qwen/qwen3.8-flash`, `qwen/qwen3.8-flash-next` |
| Zhipu | `z-ai/glm-5.3-flash`, `stealth/ox-alpha` (unmasked as GLM-5.3-Flash), `glm-5.3-fast` (gateway serving ID; see caveat below) |
| StepFun | `stepfun/step-3.7-flash` |
| InclusionAI | `inclusionai/ling-3.0-flash`, `inclusionai/ling-3.0-flash-fin`, `inclusionai/ling-3.1-flash` |
| NVIDIA | `nemotron-3.5-lightning` |
| Liquid | `lfm-2.5-2.6b` |
| IBM | `ibm-granite/granite-4.2-8b` |
| Inception | `inception/mercury-2.5-preview` |
| Tencent | `hy-mt2-1.8b`, `hy-mt2-7b`, `hy-mt2-30b-a3b`, `hy-mt*` |
| Xiaomi | `mimo-v2.6-flash`, `XiaomiMiMo/MiMo-V2.6-Flash-RL` |
| Bilibili Index | `IndexTeam/Index-Translate-2B`, `IndexTeam/Index-Translate-9B`, `IndexTeam/Index-Translate-35B-A3B-preview` |
| Markers | `haiku`, `flash`, `lite`, `micro`, `fast`, `lightning`, `gemma`, `phi`, `1b`…`14b` (incl. `2.6b`) |

> **Decision note (2026-08 steer):** `grok-composer-2.5-fast` is classified **small**, not large.
> The `composer … fast` naming marks xAI's cheap/fast tier, and the explicit
> `composer` + `fast` rule wins over the generic `grok` → large family rule.
> This is a deliberate behavior change vs the pre-2026-08 catalog; it lowers
> the central estimate for that model from 2.5 to 0.15 gCO₂e / 1k output tokens.

> **Decision note (2026-08-16 steer):** `grok-4.6` stays **large**, not frontier.
> OpenRouter describes it as xAI's smartest coding/STEM model; the catalog
> still treats the whole `grok` family as the large workhorse band, consistent
> with `grok-4.3` / `grok-4.5`. `qwen3.8-max` / `qwen3.8-2.4t-a95b` stay
> **large** for the same family-rule reason (`qwen` → large), matching
> `qwen3.7-max`. `seed-2-1-turbo` is **large** (coding/agent workhorse);
> `lite`/`mini` Seed IDs remain small.

> **Decision note (2026-08-23 steer):** `z-ai/glm-5.3` stays **large** (`glm`
> family, reasoning / agent workhorse). `meta/muse-spark-1.2-contributor`
> stays **large** — `contributor` is not a small marker; the `muse` family
> rule wins even though the contributor SKU is cheaper than Spark. Tencent
> `hy-mt2*` (Hunyuan-MT translation specialists, including `30b-a3b` with
> 3B active) is classified **small**. `deepseek-v4-flash-vision-exp` is
> **small** via `flash`.

> **Decision note (2026-08-30 steer):** `stealth/ox-alpha` is classified **small**,
> not medium/guessed. Z.ai unmasked it on 2026-08-26 as `GLM-5.3-Flash`
> (320B-A18B). The `flash` marker already maps `glm-5.3-flash` / `qwen3.8-flash-next`
> to small; the explicit `ox-alpha` rule keeps the stealth ID aligned with that
> SKU. `glm-5.3` (non-flash) stays **large**. Factor *bands* unchanged.

> **Decision note (2026-09-06 steer):** `gpt-6-astra` / `gpt-6-astra-pro` are
> classified **frontier**, not medium/guessed. OpenAI's GPT-6 flagship began a
> phased rollout on 2026-09-03 (API IDs also listed as `openai/gpt-6-astra`).
> The `gpt-6` rule is checked after small markers, so a hypothetical
> `gpt-6-mini` / `luna` still lands small. `claude-fable-5.1` and
> `claude-mythos-5.1` stay **frontier** via existing `fable` / `mythos`.
> `gemini-3.8-flash` (and the Fairwind-gated Cyber variant) is **small** via
> `flash`. `muse-spark-1.3` / `muse-spark-1.3-contributor` stay **large** via
> `muse`. `qwen3.8-max-0902` stays **large** via `qwen`.
> `ibm-granite/granite-4.2-8b` is **small** via `8b`.
> `inception/mercury-2.5-preview` is classified **small** (diffusion LLM,
> vendor-compared to Luna / Flash-Lite / Haiku). `tencent/hy4-preview` is
> **large** (Hunyuan 4, 770B-A49B coding flagship) — the `hy-mt` translation
> family remains small; `hy4` is a different product. Factor *bands* unchanged.
> No new uncatalogued IDs in Hermes usage this week.
>
> **Decision note (2026-09-13 steer):** `deepseek-v4.1-flash` /
> `deepseek/deepseek-v4.1-flash` / API alias `deepseek-flash` are **small**
> via `flash`. DeepSeek launched V4.1-Flash on 2026-09-10 (MIT weights;
> older V4 Flash / Flash Vision API names now route here). `gemini-3.8-flash-cyber`
> stays **small** via `flash`. `inclusionai/ling-3.0-flash-fin` is **small**
> via `flash`. `meituan/longcat-2.0` (and `:free`) is classified **large**,
> not medium/guessed — Meituan LongCat-2.0 is a 1.6T-A48B coding workhorse,
> same band as Kimi / DeepSeek-Pro / Qwen-Max. Factor *bands* unchanged.
>
> **Decision note (2026-09-20 steer):** Moonshot's `kimi-k2.8-preview` is
> **large** through the existing `kimi` family rule; its Kimi Code rollout also
> retains the `kimi-for-coding` endpoint. Shanghai AI Lab's
> `Atria-Dawn-Preview` is **large**, not medium/guessed: it is a 744B
> agentic-MoE release built on the GLM-5.2 lineage, so an explicit `atria` rule
> aligns it with GLM/Kimi/DeepSeek workhorses. Hermes usage also contains
> `upstage/solar-pro4:free`; Upstage describes Solar Pro 4 as its 512K-context
> agentic LLM, and the explicit `solar-pro` rule maps it **large**. The complete
> `gpt-5.2-codex`, `gpt-5.3-codex`, and `gemini-3.1-flash-lite-preview` IDs
> were documented as already-covered family variants. Factor *bands* unchanged.

## 2026-10-04 steer: releases, catch-up and provenance

The previous catalog refresh was 2026-09-20. This steer covers **2026-09-28 through 2026-10-04**, plus missing releases since that refresh.

- [GPT-6.1 Sol](https://openai.com/index/introducing-gpt-6-1-sol/) (September 29) → **frontier** through existing `sol` / `gpt-6` rules. Hermes also recorded `gpt-6.1-sol`. Cheaper API pricing alone does not justify changing an emission band.
- [Claude Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5) (September 28), API `claude-sonnet-5-5` → **large** through `sonnet`; also seen in Hermes.
- [Gemini 4 Argon](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/) (September 30) → **frontier** through an explicit Gemini + Argon product-name rule. Access is restricted to trusted Fairwind cyber defenders. The spelling `gemini-4-argon` is a catalog label, **not a confirmed public API ID or a claim of general availability**.
- [Index-Translate](https://huggingface.co/IndexTeam/Index-Translate-35B-A3B-preview) → **small**: `2B` / `9B` already match parameter markers; the `35B-A3B-preview` text-translation checkpoint gets a narrow explicit rule for its 3B-active MoE, consistent with Hy-MT2-30B-A3B. Local inference is still outside these cloud-token estimates.
- Catch-up: [GPT-6 Sol / Luna](https://openai.com/index/introducing-gpt-6-sol-and-luna/) and [Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5) (September 22) → **frontier / small / frontier** through existing rules. Preserve the Hermes alias `claude-opus-5-5[1m]` literally; `[1m]` does not change its class.
- Catch-up: [Grok 4.7](https://x.ai/news/grok-4-7) (September 21) → **large**, as for prior Grok flagships; seen in Hermes. [MiMo-V2.6](https://mimo.xiaomi.com/mimo-v2-6) (September 22, vendor date) → **large** for Pro / Pro-RL / Pro-UltraSpeed (42B active), **small** for Flash / Flash-RL through `flash`. `UltraSpeed` is a serving mode, not the whole-token `ultra` marker.
- [Pareto 26.10 Preview](https://unbiased.ai/changelog/) (October 1) uses the unchanged API ID `pareto`. It remains **medium + guessed**: routing/backend composition is not disclosed sufficiently to infer an emission class from price or benchmarks.

All Hermes model strings checked in this run have a known classification. **Emission bands, input-token weight and factors version are unchanged.** New mappings only; no historical event rewrite.

### Decision models: tracked, not validated by the token formula

[Cloudflare Clef / Clef-flash](https://blog.cloudflare.com/clef-decision-models/), [Perplexity `pplx-decider-v1-27b`](https://huggingface.co/perplexity-ai/pplx-decider-v1-27b) and [Strands `strands-decider-2b`](https://strandsagents.com/blog/introducing-strands-decider/) were also reviewed. They return decisions/probabilities rather than autoregressive text. Their generic heuristic results (e.g. `flash` / `2b` → small) **are not validated emissions factors for decision inference**; do not substitute option counts for output tokens. No new decision-specific bands are introduced. Audio/video-generation releases are outside this text-token catalog's supported accounting.

## 2026-10-11 steer: releases, serving variants and catch-up

Review window: **2026-10-05 through 2026-10-11**. Release announcements are distinguished from gateway additions and serving updates; a tracker first seeing a model this week does not establish its launch date.

- [Claude Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5) (October 7, publisher date), `claude-haiku-5-5` / `anthropic/claude-haiku-5.5` → **small**, using the existing `haiku` marker. Effort controls, lower prices and a changed tokenizer do not alter the factor bands.
- [Reflection Beam](https://reflection.ai/blog/introducing-beam) (announced October 5; benchmark update October 8) → **large** through a narrow product-name rule: a text-only 501B-total / 23B-active coding and agentic MoE. Early access is waitlisted; weights and developer artifacts are promised later in October, **not confirmed released**. `Beam` is a catalog label, not a confirmed public API ID. Vendor compute comparisons are not measured gCO₂e.
- [Mistral Large 4](https://openrouter.ai/mistralai/mistral-large-4-0), gateway ID `mistralai/mistral-large-4-0` (listed October 6) → **large**, through the existing Mistral + large rule, regardless of the provider's capability label “frontier”.
- [Step 5 Preview](https://openrouter.ai/stepfun/step-5-preview), `stepfun/step-5-preview` (October 8 gateway listing) → **large** through the existing Step family rule; 600B total / 27B active coding and agent workhorse.
- [GLM 5.3 Fast](https://llmgateway.io/models/glm-5.3-fast), `glm-5.3-fast` (October 7 gateway listing) → **small** through the existing `fast` marker. **Important limitation:** the gateway describes this as accelerated GLM-5.3 / Prime with unchanged capabilities, not a disclosed smaller architecture. This is the requested naming heuristic, **not evidence of lower per-token emissions**. Bare `glm-5.3` remains large; no new Z.ai base-model launch is asserted.
- Catch-up: [MiniMax M3](https://www.minimax.io/blog/minimax-m3), official API `MiniMax-M3` and checkpoint `MiniMaxAI/MiniMax-M3` → **large** through a narrow M3 rule. [SambaCloud prompt caching](https://sambanova.ai/blog/introducing-prompt-caching-for-minimax-m3-on-sambacloud) (October 7) is a serving update, **not an M3 launch this week**. Do not extend this rule to MiniMax H3 media generation or undocumented future models.
- Catch-up: [Ling 3.1 Flash](https://openrouter.ai/inclusionai/ling-3.1-flash), `inclusionai/ling-3.1-flash` (gateway listing October 2) → **small** through `flash`; not a new October 5–11 base-model launch.
- [Reka Edge 2603](https://llmgateway.io/models/reka-edge-2603), `reka-edge-2603` (gateway listing October 9) remains **medium + guessed** pending sufficient architecture/inference provenance. Low price and the word “Edge” do not establish a small emissions class.

[GPT-6 / Intelligent UI](https://openai.com/index/gpt-6-for-everyone) is a ChatGPT rollout; this source does not establish a new public API ID. No ID is invented. No additional uncatalogued text-model release was confirmed for Google, xAI, DeepSeek, Moonshot/Kimi, Qwen or Meta Muse in the reviewed sources. Existing Hermes model strings remain covered; no new usage ID needs a mapping this week.

Clef-omni and `pplx-decider-v1.1-27b` are decision-model updates, not supported autoregressive-token workloads. Qwen-Image-2.1-Turbo, Nano Banana 2.1, Grok Imagine Video 1.5 Lite and speech/music releases remain outside these text-token estimates. Gemini Omni SDK enum additions alone do not validate audio/video-output accounting.

**Emission bands, input-token weight and factors version remain unchanged.** New mappings and catalog examples only; no historical ledger rewrite. These are cloud-inference heuristics, not local-compute measurements.

## Medium (guessed)

Anything without a known marker. Central **0.8 gCO₂e / 1k output tokens**, range widened in `status`.

`pareto` and `reka-edge-2603` are documented here as **medium + guessed**, pending backend/inference provenance; neither was found in Hermes usage.

If your production model lands here, open an issue or wait for the weekly steer.

## Weekly steer

Every **Sunday 20:00 Europe/Zurich**, Hermes:

1. Scans public release notes + Hermes `session_model_usage` for new model IDs
2. Proposes class mappings (frontier / large / medium / small)
3. Updates `factors.ts` + this page + methodology examples
4. Rebuilds and deploys [docs.carbonmd.dev](https://docs.carbonmd.dev)
5. Commits and pushes changes to both public and private GitHub repositories, then reports what changed

No silent factor-band rewrites: class **values** (gCO₂e table) only change with an explicit factors version bump and human review.

## Related

- [`carbon-md factors`](/cli/factors/) — print the active table from the CLI
- [Methodology](/methodology/) — derivation and token rules
- [GitHub issues](https://github.com/carbon-md/carbon-md/issues) — suggest a mapping
