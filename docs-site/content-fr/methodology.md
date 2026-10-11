# Méthodologie & facteurs

## Version
```
carbonmd-factors-2026-08
```
Mis à jour le **2026-10-11** (nouveaux IDs seulement ; bandes gCO₂e inchangées).

## Formule
```
weighted_ktokens = (output_tokens + 0.2 × input_tokens) / 1000
gCO2e = class_factor × weighted_ktokens
```

| Classe | Bas | Central | Haut |
|---|---|---|---|
| frontier | 1.5 | 4.5 | 15 |
| large | 0.8 | 2.5 | 8 |
| medium | 0.2 | 0.8 | 2.5 |
| small | 0.03 | 0.15 | 0.6 |

## Classification
- **small** : mini, flash, luna, lite, fast, lightning, mercury, hy-mt / hunyuan-mt, ox-alpha (GLM-5.3-Flash), 1b–14b (dont 2.6b)…
- **frontier** : opus, fable, sol, `gpt-5.2-codex`, `gpt-5.3-codex`, gpt-5.5, gpt-6-astra…
- **large** : sonnet, terra, kimi (dont `kimi-k2.8-preview`), deepseek, grok, qwen, glm, seed, sakana/namazu, muse, hy4, longcat, `solar-pro` (Upstage), `atria` (Shanghai AI Lab)…
- **medium** : guessed

Règles ajoutées : Gemini + Argon → **frontier** ; MiMo + Pro → **large** ; exception précise Index-Translate-35B-A3B-preview → **small** (3B actifs). Heuristiques de nom/architecture, pas mesures d’énergie ; les marqueurs small restent prioritaires.

## Exemples du steer 2026-10-04

| Classe | Exemples |
|---|---|
| **frontier** | `gpt-6.1-sol`, `gpt-6-sol`, `claude-opus-5-5[1m]`, Gemini 4 Argon (préversion limitée ; ID API public non confirmé) |
| **large** | `claude-sonnet-5-5`, `grok-4.7`, `XiaomiMiMo/MiMo-V2.6-Pro-RL`, `mimo-v2.6-pro-ultraspeed` |
| **small** | `gpt-6-luna`, `XiaomiMiMo/MiMo-V2.6-Flash-RL`, `IndexTeam/Index-Translate-2B`, `IndexTeam/Index-Translate-9B`, `IndexTeam/Index-Translate-35B-A3B-preview` |
| **medium (guessed)** | `pareto` (26.10 Preview ; provenance des backends non résolue) |

## Exemples du steer 2026-10-11

| Classe | Exemples |
|---|---|
| **large** | Beam (nom produit en accès anticipé, pas un ID API confirmé), `MiniMax-M3`, `MiniMaxAI/MiniMax-M3`, `mistralai/mistral-large-4-0`, `stepfun/step-5-preview` |
| **small** | `claude-haiku-5-5`, `anthropic/claude-haiku-5.5`, `inclusionai/ling-3.1-flash`, `glm-5.3-fast` |
| **medium (guessed)** | `reka-edge-2603` (ID gateway ; provenance d’architecture/inférence insuffisante) |

Nouvelles règles explicites limitées à Reflection Beam et MiniMax M3 ; les autres exemples utilisent les marqueurs existants. **`glm-5.3-fast` est small uniquement via la règle de nom `fast`.** La gateway décrit un GLM-5.3 accéléré aux capacités inchangées, pas une architecture plus petite : aucune réduction mesurée d’émissions n’est démontrée. `glm-5.3` reste large. M3 et Ling 3.1 Flash sont des rattrapages, pas des lancements cette semaine. Bandes et poids des tokens d’entrée inchangés.

Les modèles de décision Clef, Perplexity Decider et Strands Decider sont suivis, mais **pas validés par la formule de tokens de sortie autorégressifs** : options/probabilités ne sont pas des tokens générés. La génération audio/vidéo et l’inférence locale nécessitent un autre calcul ; un marqueur reconnu ne les rend pas pris en charge.

Détails et sources : [Catalogue modèles](/fr/models/).
