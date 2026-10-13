# carbon.md

[![npm](https://img.shields.io/npm/v/carbon-md)](https://www.npmjs.com/package/carbon-md) [![license](https://img.shields.io/badge/license-MIT-green)](LICENSE) ![spec](https://img.shields.io/badge/spec-v0.1_draft-blue)

**An open standard for carbon-governed AI agents.** — Spec v0.1 (draft)

A `carbon.md` file in your repository declares your agents' carbon policy: how their emissions are estimated, what share of them is matched by verified carbon-removal **contributions**, what they may spend, and where the proof lives. Humans set the policy. Agents execute within it. Everything is provable.

```bash
npx carbon-md init
```

> Think `AGENTS.md`, but for your agents' environmental footprint — and inspired by [auth.md](https://workos.com/auth-md)'s "a Markdown file is the interface" approach.

---

## Why

AI agents run thousands of LLM calls a day. Their operators currently have three bad options: ignore the footprint, buy into heavyweight enterprise carbon suites, or make offset claims that will be illegal in the EU from September 2026 (ECGT directive bans offset-based "carbon neutral" product claims). `carbon.md` is the fourth option:

1. **Measure** — token usage is captured at chokepoints (LiteLLM, Claude Code, framework callbacks) and converted to CO₂e estimates *with explicit uncertainty ranges*.
2. **Govern** — a human-authored policy file sets contribution targets, budget caps, and approval thresholds that agents must respect.
3. **Contribute** — emissions are matched by verified carbon-removal purchases (monthly, confirm-first by default — agents never spend unattended above your threshold).
4. **Prove** — every retirement gets a public receipt; the badge links to a ledger, not to a vibe.

## Quickstart

```bash
npx carbon-md init          # detect your stack, write carbon.md, set up .carbon-md/
npx carbon-md sync claude-code     # pull usage straight from Claude Code transcripts
npx carbon-md ingest usage.jsonl   # or feed any usage logs (LiteLLM, custom)
npx carbon-md status        # footprint with uncertainty range + contribution due
npx carbon-md contribute    # prepare the monthly contribution order
npx carbon-md export        # build a public ledger page + badge.svg + ledger.json
```

`export` writes a self-contained `public/` you can host anywhere (Cloudflare Pages, GitHub Pages, Vercel) — a receipt, not a vibe.

See [docs/capture.md](docs/capture.md) for capture recipes (Claude Code, LiteLLM, generic JSONL).

## The file

`carbon.md` lives at the repository root. It is Markdown with a YAML front-matter policy block — readable by humans, parseable by tools, and ingestible by the agents it governs.

```markdown
---
carbon_md: "0.1"
policy:
  contribution_target: 1.10
  portfolio: removal-weighted
  monthly_budget_max: { amount: 25, currency: USD }
  approval_above: { amount: 10, currency: USD }
reporting:
  mode: local
  public_ledger: true
methodology: carbonmd-factors-2026-08
---

# Carbon Policy — my-project

This project's agents measure their inference emissions and fund verified
carbon removal per the policy above.
```

### Field reference (v0.1)

| Field | Req | Meaning |
|---|---|---|
| `carbon_md` | MUST | Spec version this file targets (`"0.1"`) |
| `policy.contribution_target` | MUST | Multiplier of estimated emissions to match with contributions. `1.0` = 100%, `1.1` = 110% |
| `policy.portfolio` | SHOULD | `removal-only`, `removal-weighted` (default), `balanced`, or `custom`. Determines default price assumptions and rail suggestions. Under `removal-only`, `contribute --execute` refuses any credit not classified as removal — avoidance is rejected before a quote is even requested |
| `policy.monthly_budget_max` | MUST | Hard cap. No tool or agent may initiate contributions beyond this in a calendar month (UTC) |
| `policy.approval_above` | MUST | Orders above this amount require explicit human confirmation. Set to `{ amount: 0 }` to require approval for everything |
| `reporting.mode` | SHOULD | `local` (ledger stays in `.carbon-md/`) or `hosted` (also pushed to a ledger service) |
| `reporting.public_ledger` | SHOULD | Whether aggregate footprint + receipts may be published |
| `methodology` | MUST | Versioned identifier of the emission-factor set used. Estimates are only comparable within a methodology version |

### Rules for implementers (agents & tools)

- Tools **MUST NOT** initiate spend exceeding `monthly_budget_max`, and **MUST** obtain human confirmation above `approval_above`.
- Emission estimates **MUST** be stored and displayed as ranges (low/central/high), never as a single falsely-precise number.
- Ledger entries **MUST** record the methodology version they were computed with.
- Generated copy **MUST NOT** claim "carbon neutral", "climate neutral" or "climate positive" on the basis of contributions (EU ECGT directive, in force 27 Sept 2026). The compliant claim shape is: *"emissions are estimated and matched N% by verified carbon-removal contributions — see ledger."*
- Agents reading this file **SHOULD** treat it as policy from their principal, in the same way they treat `AGENTS.md` instructions.
- Agents and platforms that already track their own token usage **SHOULD** emit it as carbon.md usage reports (see below) — self-reporting beats being scraped, and closed tools that expose nothing (consumer apps like Pi) simply can't be governed at all.

## The usage report (v0.1)

Agents that track their own token usage — and most serious ones do — should **push** it rather than have tools scrape their internals. carbon.md defines a minimal report shape; one interface, many emitters:

```json
{"ts":"2026-07-04T12:00:00Z","source":"my-agent","provider":"anthropic","model":"claude-sonnet-5","tokens_in":8231,"tokens_out":912,"cache_read_tokens":140000}
```

| Field | Req | Notes |
|---|---|---|
| `model` | MUST | Model identifier as reported by the provider |
| `tokens_in` / `tokens_out` | MUST (≥1 of) | Fresh input (incl. cache creation) / generated output |
| `ts` | SHOULD | ISO 8601; defaults to ingestion time |
| `source` | SHOULD | Emitting tool/agent, for provenance |
| `provider` | MAY | Inference provider |
| `cache_read_tokens` | MAY | Recorded in the ledger, **excluded** from estimates (prompt-cache serving costs far less than a fresh forward pass — under-claim beats inflate) |

Aliases accepted for zero-friction interop: `input_tokens`/`prompt_tokens`, `output_tokens`/`completion_tokens`, nested `usage` objects.

**Transports (v0.1):** JSONL to `carbon-md ingest <file|->`. The CLI also auto-detects **OTLP/JSON** metric lines and flattens any `*.token.usage` metric (Claude Code, Gemini CLI/agy lineage) and the OpenTelemetry GenAI semconv `gen_ai.client.token.usage` — if your agent already speaks OTel, it already speaks carbon.md. A push endpoint (`reporting.endpoint`) is specified for v0.2. Built-in `sync` adapters (transcript scraping) exist as the zero-config fallback for tools that don't emit yet.

## Measurement methodology

v0.1 ships `carbonmd-factors-2026-08`: per-model-class gCO₂e factors per 1k tokens (output-weighted; input tokens weighted 0.2×), derived from the [EcoLogits](https://ecologits.ai/) methodology (peer-reviewed, JOSS 2025) and public provider disclosures, using a world-average grid-intensity assumption. Model → class mapping is heuristic and overridable. Run `npx carbon-md factors` to see the exact table in your installed version.

**These are estimates, not measurements.** Cloud inference is a black box; ranges are wide by design. Factor tables are versioned and updated in the open — corrections are welcome as PRs.

## Contributions & receipts

The reference CLI prepares **monthly aggregated orders** (estimated tCO₂e × `contribution_target`) against programmatic rails — [CNaught](https://www.cnaught.com/) (curated portfolios, fiat) or [Carbonmark](https://docs.carbonmark.com/) (fractional on-chain retirement) — and records the receipt in the ledger. Per-call micro-retirement is deliberately **not** part of v0.1: aggregation is cheaper, safer, and easier to audit.

## Status & roadmap

- **v0.1 (this)** — repo-level policy file + reference CLI (`init`, `ingest`, `status`, `contribute`, `factors`).
- v0.2 — domain-level discovery (`/.well-known/carbon.md`) for services, auth.md-integrated flows, hosted public ledger pages, Python SDK + LangGraph callback, automated confirm-first purchasing.
- v0.3 — CSRD-ready exports, certification.

## Contributing

The spec is a draft and the factor tables are meant to be argued with — issues and PRs welcome, especially corrections to emission factors, new capture integrations (LiteLLM, Claude Code, LangGraph, CrewAI), and implementation reports.

## Releasing

`npm publish` from a clean checkout of `main`. The build wipes `dist/` first and
`prepublishOnly` runs a preflight that checks the artifact against the source:
every command the CLI dispatches must exist in the build, and the binary must
report the version being published.

This exists because 0.1.10 shipped the 0.1.8 build under a 0.1.11-era version
number. It installed cleanly, reported the right version, and answered
"Unknown command: registry" for the feature the release was for. npm versions
are immutable, so the number was spent — hence a check rather than care.

## License

MIT — the spec and reference implementation are free forever. Standards only work when nobody owns the gate.

Stewarded by [Agentic Realism](https://agentic-realism.com).
