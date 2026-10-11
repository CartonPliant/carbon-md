# Catalogue modèles

**Dernier steer :** 2026-10-11 · `carbonmd-factors-2026-08`

## Frontier
`gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.5`, `gpt-5.6-sol`, `gpt-6-astra`, `gpt-6-astra-pro`, `claude-opus-5`, `claude-fable-5`, `claude-fable-5.1`, `claude-mythos-5.1`, `gemini-3.1-pro-preview`

Ajouts : `gpt-6-sol`, `gpt-6.1-sol`, `claude-opus-5-5`, `claude-opus-5-5[1m]`, `anthropic/claude-opus-5.5`, Gemini 4 Argon (préversion limitée ; ID API public non confirmé).

## Large
`gpt-5.6-terra`, `claude-sonnet-5`, `kimi-k2.6`, `kimi-k2.8-preview`, `kimi-k3`, `k3`, `grok-4.3`, `grok-4.5`, `grok-4.6`, `grok-build-0.1`, `deepseek-v4-pro`, `deepseek-v4-pro-0813`, `qwen3.7-max`, `qwen3.8-max`, `qwen3.8-max-0902`, `qwen3.8-2.4t-a95b`, `qwen3.8-27b`, `glm-5.2`, `glm-5.3`, `muse-spark-1.2-contributor`, `muse-spark-1.3`, `muse-spark-1.3-contributor`, `seed-2-1-turbo`, `seed-2.0-code`, `sakana-namazu`, `hy4-preview`, `longcat-2.0`, `upstage/solar-pro4:free`, `Atria-Dawn-Preview`

Ajouts : `claude-sonnet-5-5`, `anthropic/claude-sonnet-5.5`, `grok-4.7`, `mimo-v2.6-pro`, `XiaomiMiMo/MiMo-V2.6-Pro-RL`, `mimo-v2.6-pro-ultraspeed`, Beam (nom produit en accès anticipé ; ID API public non confirmé), `MiniMax-M3`, `MiniMaxAI/MiniMax-M3`, `mistral-large-4`, `mistralai/mistral-large-4-0`, `stepfun/step-5-preview`.

## Small
`gpt-5.6-luna`, `gpt-5.4-mini`, `gemini-3.1-flash-lite-preview`, `gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`, `gemini-3.8-flash-cyber`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4.1-flash`, `deepseek-flash`, `grok-composer-2.5-fast`, `qwen3.8-flash`, `qwen3.8-flash-next`, `glm-5.3-flash`, `stealth/ox-alpha`, `step-3.7-flash`, `ling-3.0-flash-fin`, `nemotron-3.5-lightning`, `lfm-2.5-2.6b`, `hy-mt2-1.8b`, `hy-mt2-7b`, `hy-mt2-30b-a3b`, `granite-4.2-8b`, `mercury-2.5-preview`

Ajouts : `gpt-6-luna`, `mimo-v2.6-flash`, `XiaomiMiMo/MiMo-V2.6-Flash-RL`, `IndexTeam/Index-Translate-2B`, `IndexTeam/Index-Translate-9B`, `IndexTeam/Index-Translate-35B-A3B-preview`, `claude-haiku-5-5`, `anthropic/claude-haiku-5.5`, `glm-5.3-fast` (ID de service gateway ; réserve ci-dessous), `inclusionai/ling-3.1-flash`.

> **Note de décision (steer 2026-08) :** `grok-composer-2.5-fast` est classé **small**, pas large.
> La règle explicite `composer` + `fast` (tier rapide/économique xAI) prime sur la règle
> générique `grok` → large. Changement voulu : l'estimation centrale passe de 2,5 à 0,15 gCO₂e / 1k tokens de sortie.

> **Note de décision (steer 2026-08-16) :** `grok-4.6` reste **large** (famille grok, comme 4.3/4.5), pas frontier. `qwen3.8-max` / `qwen3.8-2.4t` restent **large**. `seed-2-1-turbo` est **large** ; les IDs Seed `lite`/`mini` restent small.

> **Note de décision (steer 2026-08-23) :** `glm-5.3` reste **large** (famille glm). `muse-spark-1.2-contributor` reste **large** (`contributor` n'est pas un marqueur small). Famille Tencent `hy-mt2*` → **small**. `deepseek-v4-flash-vision-exp` → **small** (`flash`).

> **Note de décision (steer 2026-08-30) :** `stealth/ox-alpha` est classé **small**, plus medium/guessed. Z.ai l’a démasqué le 2026-08-26 comme `GLM-5.3-Flash`. Le marqueur `flash` classe déjà `glm-5.3-flash` / `qwen3.8-flash-next` en small ; la règle `ox-alpha` aligne l’ID stealth. `glm-5.3` (sans flash) reste **large**. Bandes gCO₂e inchangées.

> **Note de décision (steer 2026-09-06) :** `gpt-6-astra` / `gpt-6-astra-pro` sont classés **frontier**, pas medium/guessed. Flagship GPT-6 d’OpenAI, déploiement progressif dès le 2026-09-03. La règle `gpt-6` vient après les marqueurs small : un hypothétique `gpt-6-mini` resterait small. `claude-fable-5.1` / `claude-mythos-5.1` restent **frontier** (`fable` / `mythos`). `gemini-3.8-flash` → **small** (`flash`). `muse-spark-1.3` reste **large** (`muse`). `qwen3.8-max-0902` reste **large**. `granite-4.2-8b` → **small** (`8b`). `mercury-2.5-preview` → **small** (diffusion, classe Luna / Flash-Lite / Haiku). `hy4-preview` → **large** (Hunyuan 4 flagship) ; la famille `hy-mt` reste small. Bandes gCO₂e inchangées. Aucun nouvel ID uncatalogué dans l’usage Hermes cette semaine.

> **Note de décision (steer 2026-09-13) :** `deepseek-v4.1-flash` / alias API `deepseek-flash` → **small** (`flash`). Sortie DeepSeek V4.1-Flash le 2026-09-10. `gemini-3.8-flash-cyber` et `ling-3.0-flash-fin` → **small** (`flash`). `meituan/longcat-2.0` → **large**, plus medium/guessed (workhorse 1.6T-A48B, même bande que Kimi / DeepSeek-Pro / Qwen-Max). Bandes gCO₂e inchangées.
>
> **Note de décision (steer 2026-09-20) :** `kimi-k2.8-preview` est **large** via la règle de famille `kimi` ; son déploiement Kimi Code conserve aussi l’endpoint `kimi-for-coding`. `Atria-Dawn-Preview` (Shanghai AI Lab) est **large**, pas medium/guessed : MoE agentique 744B issu de la lignée GLM-5.2, il rejoint les workhorses GLM / Kimi / DeepSeek via une règle explicite `atria`. L’ID vu dans Hermes `upstage/solar-pro4:free` est **large** via `solar-pro` : Solar Pro 4 est le LLM agentique 512K d’Upstage. Les variantes déjà couvertes `gpt-5.2-codex`, `gpt-5.3-codex` et `gemini-3.1-flash-lite-preview` sont maintenant listées. Bandes gCO₂e inchangées.

## Steer 2026-10-04 : sorties, rattrapage et sources

Le catalogue précédent datait du 2026-09-20. Revue du **2026-09-28 au 2026-10-04**, avec rattrapage des sorties manquantes depuis ce dernier steer.

- **Frontier** : `gpt-6.1-sol` ([OpenAI, 29 septembre](https://openai.com/index/introducing-gpt-6-1-sol/)) et Gemini 4 Argon ([Google, 30 septembre](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-4-argon/)). Sol utilise les règles existantes ; Argon reçoit une règle explicite Gemini + Argon. Argon est réservé aux cyberdéfenseurs Fairwind : `gemini-4-argon` est un libellé de catalogue, **pas un ID API public confirmé ni une disponibilité générale**.
- **Large** : `claude-sonnet-5-5`, `anthropic/claude-sonnet-5.5` ([Anthropic, 28 septembre](https://www.anthropic.com/claude-sonnet-5-5)), via `sonnet`.
- **Small** : `IndexTeam/Index-Translate-2B`, `IndexTeam/Index-Translate-9B`, `IndexTeam/Index-Translate-35B-A3B-preview` ([fiche officielle](https://huggingface.co/IndexTeam/Index-Translate-35B-A3B-preview)). Les tailles 2B/9B étaient couvertes ; exception étroite pour le MoE de traduction 35B/3B actifs, cohérente avec Hy-MT2-30B-A3B. Le calcul local reste hors estimation cloud.
- **Rattrapage frontier** : `gpt-6-sol` ([OpenAI, 22 septembre](https://openai.com/index/introducing-gpt-6-sol-and-luna/)), `claude-opus-5-5`, `claude-opus-5-5[1m]`, `anthropic/claude-opus-5.5` ([Anthropic, 22 septembre](https://www.anthropic.com/claude-opus-5-5)). L’alias Hermes `[1m]` est conservé à l’identique, sans changement de classe.
- **Rattrapage large** : `grok-4.7` ([xAI, 21 septembre](https://x.ai/news/grok-4-7)), `mimo-v2.6-pro`, `XiaomiMiMo/MiMo-V2.6-Pro-RL`, `mimo-v2.6-pro-ultraspeed` ([Xiaomi, 22 septembre](https://mimo.xiaomi.com/mimo-v2-6)). Pro : 42B actifs, règle explicite large ; UltraSpeed est un mode de service, pas le marqueur entier `ultra`.
- **Rattrapage small** : `gpt-6-luna`, `mimo-v2.6-flash`, `XiaomiMiMo/MiMo-V2.6-Flash-RL`, via les marqueurs existants `luna` / `flash`.
- **Medium + guessed** : `pareto`, ID inchangé de [Pareto 26.10 Preview, 1er octobre](https://unbiased.ai/changelog/). Composition/routage insuffisamment documentés : ni le prix ni les benchmarks ne prouvent une classe d’émissions.

Les nouveaux IDs effectivement présents dans Hermes (`gpt-6.1-sol`, `gpt-6-sol`, `claude-opus-5-5[1m]`, `claude-sonnet-5-5`, `grok-4.7`) ont tous une classe connue. **Bandes gCO₂e, poids des tokens d’entrée et version inchangés.** Aucun événement historique réécrit.

### Modèles de décision : suivis, hors validation de la formule

[Clef / Clef-flash](https://blog.cloudflare.com/clef-decision-models/), [`pplx-decider-v1-27b`](https://huggingface.co/perplexity-ai/pplx-decider-v1-27b) et [`strands-decider-2b`](https://strandsagents.com/blog/introducing-strands-decider/) produisent des décisions/probabilités, pas du texte autorégressif. Le résultat de l’heuristique générique (`flash` / `2b` → small, par exemple) **n’est pas un facteur d’émissions validé pour ces appels**. Ne pas compter les options comme des tokens de sortie. Pas de nouvelles bandes dédiées. Les sorties audio/vidéo ne sont pas couvertes par ce catalogue de tokens texte.

## Steer 2026-10-11 : sorties, variantes de service et rattrapage

Revue du **2026-10-05 au 2026-10-11**. Une première apparition dans un tracker n’est pas une preuve de lancement cette semaine : annonces, ajout gateway et optimisation du service sont distingués.

- [Claude Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5) (7 octobre, date éditeur), `claude-haiku-5-5` / `anthropic/claude-haiku-5.5` → **small**, marqueur existant `haiku`. Réglage d’effort, prix et tokenizer ne changent pas les bandes.
- [Reflection Beam](https://reflection.ai/blog/introducing-beam) (annonce le 5 octobre ; benchmarks actualisés le 8) → **large** via une règle étroite sur le nom produit : MoE texte de coding/agents, 501B totaux / 23B actifs. Accès anticipé sur liste d’attente ; poids et outils promis plus tard en octobre, **pas confirmés publiés**. `Beam` est un libellé, pas un ID API public confirmé. Les comparaisons de calcul du fournisseur ne sont pas des mesures gCO₂e.
- [Mistral Large 4](https://openrouter.ai/mistralai/mistral-large-4-0), `mistralai/mistral-large-4-0` (référencé le 6 octobre) → **large**, règle existante Mistral + large, indépendamment du qualificatif de capacité « frontier » de l’éditeur.
- [Step 5 Preview](https://openrouter.ai/stepfun/step-5-preview), `stepfun/step-5-preview` (référencé le 8 octobre) → **large**, règle Step existante ; MoE de coding/agents 600B totaux / 27B actifs.
- [GLM 5.3 Fast](https://llmgateway.io/models/glm-5.3-fast), `glm-5.3-fast` (gateway, 7 octobre) → **small**, marqueur existant `fast`. **Réserve importante :** la gateway décrit un GLM-5.3 / Prime accéléré, aux capacités inchangées, pas une architecture plus petite divulguée. Heuristique de nom demandée, **pas une preuve de baisse d’émissions par token**. `glm-5.3` reste large ; aucune nouvelle sortie de modèle de base Z.ai affirmée.
- Rattrapage : [MiniMax M3](https://www.minimax.io/blog/minimax-m3), API `MiniMax-M3` / checkpoint `MiniMaxAI/MiniMax-M3` → **large**, nouvelle règle limitée à M3. Le [prompt caching SambaCloud](https://sambanova.ai/blog/introducing-prompt-caching-for-minimax-m3-on-sambacloud) (7 octobre) est une optimisation du service, **pas un lancement M3 cette semaine**. Pas d’extension à H3 génératif ni aux futurs modèles inconnus.
- Rattrapage : [Ling 3.1 Flash](https://openrouter.ai/inclusionai/ling-3.1-flash), `inclusionai/ling-3.1-flash` (gateway, 2 octobre) → **small** via `flash` ; pas une sortie de base du 5–11 octobre.
- [Reka Edge 2603](https://llmgateway.io/models/reka-edge-2603), `reka-edge-2603` (gateway, 9 octobre) reste **medium + guessed**, provenance d’architecture/inférence insuffisante. Le prix et le mot « Edge » ne prouvent pas une classe small.

[GPT-6 / Intelligent UI](https://openai.com/index/gpt-6-for-everyone) est un déploiement ChatGPT ; cette source ne confirme pas de nouvel ID API public. Aucun ID inventé. Aucune autre sortie texte non cataloguée confirmée pour Google, xAI, DeepSeek, Moonshot/Kimi, Qwen ou Meta Muse dans les sources examinées. Tous les IDs Hermes inspectés restent couverts ; aucun nouvel ID d’usage à mapper cette semaine.

Clef-omni et `pplx-decider-v1.1-27b` : mises à jour de modèles de décision, hors formule autorégressive. Qwen-Image-2.1-Turbo, Nano Banana 2.1, Grok Imagine Video 1.5 Lite et sorties voix/musique : hors estimation tokens texte. Les ajouts d’enums Gemini Omni dans un SDK ne valident pas le calcul pour les sorties audio/vidéo.

**Bandes gCO₂e, poids des tokens d’entrée et version inchangés.** Mappings et exemples seulement ; aucun historique réécrit. Heuristiques cloud, pas mesures de calcul local.

## Medium
Inconnu / guessed. `pareto` et `reka-edge-2603` sont documentés **medium + guessed**, en attente de provenance des backends/inférence ; absents de l’usage Hermes inspecté.

Steer auto : dimanche 20:00 Europe/Zurich.
